// Spectrogram render kernel: grid of floats -> RGBA pixels.
//
// Output buffer is RGBA, width=cols, height=num_bins, row-major, with
// row 0 = highest frequency (image-top). Source grid is column-major:
// grid[col * num_bins + bin], bin 0 = lowest frequency.
//
// Two modes supported via the (ref, floor_value, db_mult) triple:
//   - magnitude: db_mult=20, ref=MAG_REF, floor_value=MAG_REF*10^(floor_db/20)
//   - energy:    db_mult=10, ref=frames_per_col * MAG_REF_ENERGY,
//                floor_value=ref * 10^(floor_db/10)

#include <stdint.h>
#include <stddef.h>
#include <math.h>
#include <wasm_simd128.h>

#include "render.h"

// Branchless log10(x) for positive-finite x via IEEE-754 decomposition:
// log10(x) = log10(2) * (exponent(x) + log2(mantissa)). The mantissa
// polynomial is a degree-5 least-squares fit on m ∈ [1, 2] with max abs
// error ~3e-5 in log2 → ~1e-5 in log10. For our use that's < 0.003 colour
// indices over the 100 dB → 256 levels mapping. Caller must gate x > 0.
static inline v128_t v_log10_ps(v128_t x) {
    v128_t i = x; // reinterpret as i32x4 (same bits)
    v128_t exp_bits = wasm_i32x4_shr(i, 23);
    exp_bits = wasm_v128_and(exp_bits, wasm_i32x4_splat(0xff));
    v128_t e = wasm_i32x4_sub(exp_bits, wasm_i32x4_splat(127));
    v128_t ef = wasm_f32x4_convert_i32x4(e);

    v128_t m_bits = wasm_v128_and(i, wasm_i32x4_splat(0x007fffff));
    m_bits = wasm_v128_or(m_bits, wasm_i32x4_splat(0x3f800000));
    v128_t m = m_bits;

    v128_t c0 = wasm_f32x4_splat(-2.7868795330f);
    v128_t c1 = wasm_f32x4_splat( 5.0470816545f);
    v128_t c2 = wasm_f32x4_splat(-3.4927416179f);
    v128_t c3 = wasm_f32x4_splat( 1.5940457473f);
    v128_t c4 = wasm_f32x4_splat(-0.4049078637f);
    v128_t c5 = wasm_f32x4_splat( 0.0434332991f);
    v128_t p = wasm_f32x4_add(c4, wasm_f32x4_mul(c5, m));
    p = wasm_f32x4_add(c3, wasm_f32x4_mul(p, m));
    p = wasm_f32x4_add(c2, wasm_f32x4_mul(p, m));
    p = wasm_f32x4_add(c1, wasm_f32x4_mul(p, m));
    p = wasm_f32x4_add(c0, wasm_f32x4_mul(p, m));

    v128_t log2x = wasm_f32x4_add(ef, p);
    v128_t log10_2 = wasm_f32x4_splat(0.30102999566398f);
    return wasm_f32x4_mul(log2x, log10_2);
}

void render_kernel(
    const float* grid,
    int cols,
    int num_bins,
    float floor_db,
    float ceil_db,
    float ref,
    float floor_value,
    float db_mult,
    const uint8_t* lut,
    uint8_t* out_rgba
) {
    const float range = ceil_db - floor_db;
    const float inv_range = 1.0f / range;
    const float inv_ref = 1.0f / ref;

    v128_t v_floor_value = wasm_f32x4_splat(floor_value);
    v128_t v_inv_ref = wasm_f32x4_splat(inv_ref);
    v128_t v_db_mult = wasm_f32x4_splat(db_mult);
    v128_t v_floor_db = wasm_f32x4_splat(floor_db);
    v128_t v_ceil_db = wasm_f32x4_splat(ceil_db);
    v128_t v_inv_range = wasm_f32x4_splat(inv_range);
    v128_t v_255 = wasm_f32x4_splat(255.0f);
    v128_t v_half = wasm_f32x4_splat(0.5f);
    v128_t v_zero = wasm_f32x4_splat(0.0f);

    float scratch[4] __attribute__((aligned(16)));

    for (int col = 0; col < cols; col++) {
        const float* src = grid + (size_t)col * (size_t)num_bins;
        int b = 0;
        for (; b + 4 <= num_bins; b += 4) {
            v128_t val = wasm_v128_load(src + b);
            v128_t gated = wasm_f32x4_max(val, v_floor_value);
            v128_t ratio = wasm_f32x4_mul(gated, v_inv_ref);
            v128_t log10r = v_log10_ps(ratio);
            v128_t db = wasm_f32x4_mul(v_db_mult, log10r);
            v128_t mask = wasm_f32x4_gt(val, v_floor_value);
            db = wasm_v128_bitselect(db, v_floor_db, mask);
            db = wasm_f32x4_max(db, v_floor_db);
            db = wasm_f32x4_min(db, v_ceil_db);
            v128_t t = wasm_f32x4_mul(wasm_f32x4_sub(db, v_floor_db), v_inv_range);
            v128_t scaled = wasm_f32x4_mul(t, v_255);
            scaled = wasm_f32x4_max(scaled, v_zero);
            scaled = wasm_f32x4_min(scaled, v_255);
            scaled = wasm_f32x4_add(scaled, v_half);
            wasm_v128_store(scratch, scaled);
            for (int j = 0; j < 4; j++) {
                int idx = (int)scratch[j];
                if (idx < 0) idx = 0;
                if (idx > 255) idx = 255;
                int bin = b + j;
                int y = num_bins - 1 - bin;
                uint8_t* dst = out_rgba + ((size_t)y * (size_t)cols + (size_t)col) * 4;
                const uint8_t* px = lut + (size_t)idx * 4;
                dst[0] = px[0];
                dst[1] = px[1];
                dst[2] = px[2];
                dst[3] = px[3];
            }
        }
        for (; b < num_bins; b++) {
            float v = src[b];
            float db;
            if (v > floor_value) {
                db = db_mult * log10f(v * inv_ref);
            } else {
                db = floor_db;
            }
            if (db < floor_db) db = floor_db;
            if (db > ceil_db) db = ceil_db;
            float t = (db - floor_db) * inv_range;
            int idx = (int)(t * 255.0f + 0.5f);
            if (idx < 0) idx = 0;
            if (idx > 255) idx = 255;
            int y = num_bins - 1 - b;
            uint8_t* dst = out_rgba + ((size_t)y * (size_t)cols + (size_t)col) * 4;
            const uint8_t* px = lut + (size_t)idx * 4;
            dst[0] = px[0];
            dst[1] = px[1];
            dst[2] = px[2];
            dst[3] = px[3];
        }
    }
}

__attribute__((export_name("render_grid_to_rgba")))
void render_grid_to_rgba(
    const float* grid,
    int cols,
    int num_bins,
    float floor_db,
    float ceil_db,
    float ref,
    float floor_value,
    float db_mult,
    const uint8_t* lut,
    uint8_t* out_rgba
) {
    render_kernel(grid, cols, num_bins, floor_db, ceil_db, ref, floor_value, db_mult, lut, out_rgba);
}
