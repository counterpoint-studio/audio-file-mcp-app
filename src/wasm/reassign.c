// Auger–Flandrin spectrogram reassignment kernel.
//
// One global analyzer instance. Per frame: apply 3 windows (h, t·h, dh/dn)
// to the raw mono buffer, run 3 PFFFT forward transforms, compute per-bin
// time / frequency corrections (Δn, Δω), and scatter |X_h|² into the
// reassigned (col, logBand) cell of a WASM-resident grid.
//
// State is module-static — sufficient for the single SpectrogramAnalyzer
// in analysis-worker.ts.

#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "pffft.h"
#include "render.h"

// ----- energy reference (empirically calibrated) ----------------------------
// Per-cell |X_h|² produced by reassigning a full-scale Hann-windowed sine
// onto its dominant log-band. Measured at 1 kHz / sr=44100 / N=2048: 387920.
// Matches the Parseval estimate sum_k |X[k]|² / 2 = N · sum_n(h²) · A²/4
// ≈ 393216 within 1.4% (small residual from Hann's symmetric-endpoint form).
#define MAG_REF_ENERGY 387920.0f

// Bins with |X_h|² below this contribute no scattered energy. Roughly the
// display floor (FLOOR_DB = -100) referenced against MAG_REF_ENERGY: anything
// below this level rounds to the floor colour anyway.
#define DEFAULT_FLOOR_DB (-100.0f)
#define THRESHOLD_MAG_SQ (MAG_REF_ENERGY * 1.0e-10f)

#define M_PI_F 3.14159265358979323846f

// ----- module state ---------------------------------------------------------

static int g_fft_size = 0;
static int g_hop = 0;
static int g_num_bins = 0;
static int g_max_cols = 0;
static float g_sample_rate = 0;

static float g_min_hz = 20.0f;
static float g_log_min = 0;
static float g_log_range = 1;     // log(nyquist) - log(min_hz)
static float g_nyquist = 0;

static int g_frames_per_col = 1;
static int g_current_col = 0;     // floor(frame_index / frames_per_col)
static int g_frames_in_col = 0;   // frame_index % frames_per_col
static int g_max_col_touched = -1;

// Windows
static float* g_h = NULL;
static float* g_th = NULL;
static float* g_dh = NULL;

// PFFFT
static PFFFT_Setup* g_setup = NULL;
static float* g_pf_in_h = NULL;
static float* g_pf_in_th = NULL;
static float* g_pf_in_dh = NULL;
static float* g_pf_out_h = NULL;
static float* g_pf_out_th = NULL;
static float* g_pf_out_dh = NULL;
static float* g_pf_work = NULL;

// Grid: max_cols * num_bins floats (energy accumulator)
static float* g_grid = NULL;

// ----- helpers --------------------------------------------------------------

static void free_all(void) {
    if (g_h) { free(g_h); g_h = NULL; }
    if (g_th) { free(g_th); g_th = NULL; }
    if (g_dh) { free(g_dh); g_dh = NULL; }
    if (g_pf_in_h) { pffft_aligned_free(g_pf_in_h); g_pf_in_h = NULL; }
    if (g_pf_in_th) { pffft_aligned_free(g_pf_in_th); g_pf_in_th = NULL; }
    if (g_pf_in_dh) { pffft_aligned_free(g_pf_in_dh); g_pf_in_dh = NULL; }
    if (g_pf_out_h) { pffft_aligned_free(g_pf_out_h); g_pf_out_h = NULL; }
    if (g_pf_out_th) { pffft_aligned_free(g_pf_out_th); g_pf_out_th = NULL; }
    if (g_pf_out_dh) { pffft_aligned_free(g_pf_out_dh); g_pf_out_dh = NULL; }
    if (g_pf_work) { pffft_aligned_free(g_pf_work); g_pf_work = NULL; }
    if (g_setup) { pffft_destroy_setup(g_setup); g_setup = NULL; }
    if (g_grid) { free(g_grid); g_grid = NULL; }
}

static void build_windows(int N) {
    const float denom = (float)(N - 1);
    const float half = denom * 0.5f;
    const float w0 = 2.0f * M_PI_F / denom;
    // dh/dn for Hann h(n) = 0.5(1 - cos(2π n / (N-1))):
    //   dh/dn = (π / (N-1)) * sin(2π n / (N-1))
    const float dh_scale = M_PI_F / denom;
    for (int n = 0; n < N; n++) {
        float h = 0.5f * (1.0f - cosf(w0 * (float)n));
        g_h[n] = h;
        g_th[n] = ((float)n - half) * h;
        g_dh[n] = dh_scale * sinf(w0 * (float)n);
    }
}

// ----- exports --------------------------------------------------------------

__attribute__((export_name("reassign_init")))
float* reassign_init(
    int fft_size, int hop,
    float sample_rate, int max_cols, int num_bins,
    float min_hz, int frames_per_col
) {
    free_all();

    g_fft_size = fft_size;
    g_hop = hop;
    g_num_bins = num_bins;
    g_max_cols = max_cols;
    g_sample_rate = sample_rate;
    g_nyquist = sample_rate * 0.5f;
    g_min_hz = min_hz;
    g_log_min = logf(min_hz);
    float log_max = logf(g_nyquist);
    g_log_range = log_max - g_log_min;
    if (!(g_log_range > 0)) g_log_range = 1.0f;

    g_frames_per_col = frames_per_col > 0 ? frames_per_col : 1;
    g_current_col = 0;
    g_frames_in_col = 0;
    g_max_col_touched = -1;

    const size_t N = (size_t)fft_size;
    const size_t bytes_N = N * sizeof(float);

    g_h = (float*)malloc(bytes_N);
    g_th = (float*)malloc(bytes_N);
    g_dh = (float*)malloc(bytes_N);
    if (!g_h || !g_th || !g_dh) { free_all(); return NULL; }
    build_windows(fft_size);

    g_pf_in_h = (float*)pffft_aligned_malloc(bytes_N);
    g_pf_in_th = (float*)pffft_aligned_malloc(bytes_N);
    g_pf_in_dh = (float*)pffft_aligned_malloc(bytes_N);
    g_pf_out_h = (float*)pffft_aligned_malloc(bytes_N);
    g_pf_out_th = (float*)pffft_aligned_malloc(bytes_N);
    g_pf_out_dh = (float*)pffft_aligned_malloc(bytes_N);
    g_pf_work = (float*)pffft_aligned_malloc(bytes_N);
    g_setup = pffft_new_setup(fft_size, PFFFT_REAL);
    if (!g_pf_in_h || !g_pf_in_th || !g_pf_in_dh ||
        !g_pf_out_h || !g_pf_out_th || !g_pf_out_dh ||
        !g_pf_work || !g_setup) { free_all(); return NULL; }

    const size_t grid_floats = (size_t)max_cols * (size_t)num_bins;
    g_grid = (float*)malloc(grid_floats * sizeof(float));
    if (!g_grid) { free_all(); return NULL; }
    memset(g_grid, 0, grid_floats * sizeof(float));

    return g_grid;
}

__attribute__((export_name("reassign_set_frames_per_col")))
void reassign_set_frames_per_col(int frames_per_col) {
    g_frames_per_col = frames_per_col > 0 ? frames_per_col : 1;
}

__attribute__((export_name("reassign_reset")))
void reassign_reset(void) {
    if (!g_grid) return;
    const size_t grid_floats = (size_t)g_max_cols * (size_t)g_num_bins;
    memset(g_grid, 0, grid_floats * sizeof(float));
    g_current_col = 0;
    g_frames_in_col = 0;
    g_max_col_touched = -1;
}

__attribute__((export_name("reassign_process_frame")))
int reassign_process_frame(const float* raw, int frame_index) {
    if (!g_setup) return 0;
    const int N = g_fft_size;
    const float* h = g_h;
    const float* th = g_th;
    const float* dh = g_dh;

    // Apply three windows
    for (int n = 0; n < N; n++) {
        const float x = raw[n];
        g_pf_in_h[n] = x * h[n];
        g_pf_in_th[n] = x * th[n];
        g_pf_in_dh[n] = x * dh[n];
    }

    // 3 forward FFTs (packed-real ordered layout)
    pffft_transform_ordered(g_setup, g_pf_in_h, g_pf_out_h, g_pf_work, PFFFT_FORWARD);
    pffft_transform_ordered(g_setup, g_pf_in_th, g_pf_out_th, g_pf_work, PFFFT_FORWARD);
    pffft_transform_ordered(g_setup, g_pf_in_dh, g_pf_out_dh, g_pf_work, PFFFT_FORWARD);

    const float* Hout = g_pf_out_h;
    const float* THout = g_pf_out_th;
    const float* DHout = g_pf_out_dh;

    const float frame_t = (float)frame_index * (float)g_hop;
    const float col_period = (float)g_frames_per_col * (float)g_hop;
    const float inv_col_period = 1.0f / col_period;
    const float omega_per_bin = 2.0f * M_PI_F / (float)N;
    const float sr_over_2pi = g_sample_rate / (2.0f * M_PI_F);
    const float log_min = g_log_min;
    const float inv_log_range = 1.0f / g_log_range;
    const float nyquist = g_nyquist;
    const float min_hz = g_min_hz;
    const int num_bins = g_num_bins;
    const int max_cols = g_max_cols;

    float* grid = g_grid;

    // Per-bin reassignment + scatter (skip DC and Nyquist; they're packed
    // specially in PFFFT's ordered real output and don't carry useful phase
    // info for reassignment).
    for (int k = 1; k < N / 2; k++) {
        const int idx = 2 * k;
        const float re_h = Hout[idx];
        const float im_h = Hout[idx + 1];
        const float mag_sq = re_h * re_h + im_h * im_h;
        if (mag_sq < THRESHOLD_MAG_SQ) continue;

        const float re_th = THout[idx];
        const float im_th = THout[idx + 1];
        const float re_dh = DHout[idx];
        const float im_dh = DHout[idx + 1];
        const float inv_mag_sq = 1.0f / mag_sq;

        // dn = Re(X_th * conj(X_h)) / |X_h|²  → time-displacement in samples
        const float dn = (re_th * re_h + im_th * im_h) * inv_mag_sq;
        // dw = -Im(X_dh * conj(X_h)) / |X_h|²  → freq-displacement in rad/sample.
        // Im(X_dh * conj(X_h)) = im_dh*re_h - re_dh*im_h.
        const float dw = -(im_dh * re_h - re_dh * im_h) * inv_mag_sq;

        const float t_hat = frame_t + dn;
        const float omega_k = omega_per_bin * (float)k;
        const float omega_hat = omega_k + dw;
        const float f_hat = omega_hat * sr_over_2pi;
        if (!(f_hat >= min_hz) || !(f_hat <= nyquist)) continue;
        if (!(t_hat >= 0)) continue;

        int col = (int)floorf(t_hat * inv_col_period);
        if (col < 0 || col >= max_cols) continue;

        const float log_f = logf(f_hat);
        float band_f = (log_f - log_min) * inv_log_range * (float)num_bins;
        int band = (int)floorf(band_f);
        if (band < 0 || band >= num_bins) continue;

        grid[col * num_bins + band] += mag_sq;
        if (col > g_max_col_touched) g_max_col_touched = col;
    }

    // Bookkeeping: track nominal current_col by frame_index.
    int nominal_col = frame_index / g_frames_per_col;
    int nominal_in_col = frame_index % g_frames_per_col + 1;
    if (nominal_col >= max_cols) {
        nominal_col = max_cols - 1;
        nominal_in_col = g_frames_per_col;
    }
    g_current_col = nominal_col;
    g_frames_in_col = nominal_in_col;
    return g_current_col;
}

__attribute__((export_name("reassign_get_current_col")))
int reassign_get_current_col(void) { return g_current_col; }

__attribute__((export_name("reassign_get_frames_in_col")))
int reassign_get_frames_in_col(void) { return g_frames_in_col; }

__attribute__((export_name("reassign_get_max_col_touched")))
int reassign_get_max_col_touched(void) { return g_max_col_touched; }

__attribute__((export_name("reassign_get_grid_ptr")))
float* reassign_get_grid_ptr(void) { return g_grid; }

__attribute__((export_name("reassign_render")))
void reassign_render(
    int decoded_cols,
    float floor_db, float ceil_db,
    float ref, float floor_value, float db_mult,
    const uint8_t* lut, uint8_t* out_rgba
) {
    if (!g_grid) return;
    if (decoded_cols <= 0) return;
    if (decoded_cols > g_max_cols) decoded_cols = g_max_cols;
    render_kernel(
        g_grid, decoded_cols, g_num_bins,
        floor_db, ceil_db, ref, floor_value, db_mult,
        lut, out_rgba
    );
}
