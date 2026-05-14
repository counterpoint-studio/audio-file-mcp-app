import { describe, it, expect, beforeAll } from "vitest";
import { instantiate, getInstance } from "../dsp/wasm-dsp.gen";
import { makeColorLut } from "./spectrogram";
import { FFT_SIZE, HOP } from "./frame-router";

beforeAll(async () => {
    await instantiate();
});

describe("makeColorLut (inferno)", () => {
    const lut = makeColorLut();

    it("has 256 RGBA entries", () => {
        expect(lut.length).toBe(256 * 4);
    });

    it("starts near black and ends near pale yellow", () => {
        expect(lut[0]).toBeLessThan(8);
        expect(lut[1]).toBeLessThan(8);
        expect(lut[2]).toBeLessThan(12);
        expect(lut[255 * 4 + 0]).toBeGreaterThan(240);
        expect(lut[255 * 4 + 1]).toBeGreaterThan(240);
        expect(lut[255 * 4 + 2]).toBeGreaterThan(140);
    });

    it("is fully opaque across the table", () => {
        for (let i = 0; i < 256; i++) {
            expect(lut[i * 4 + 3]).toBe(255);
        }
    });

    it("has monotonically non-decreasing luminance", () => {
        let prev = -1;
        for (let i = 0; i < 256; i++) {
            const r = lut[i * 4 + 0];
            const g = lut[i * 4 + 1];
            const b = lut[i * 4 + 2];
            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            expect(y).toBeGreaterThanOrEqual(prev - 0.5);
            prev = y;
        }
    });
});

// ---------- reassignment kernel ----------

type ReassignMod = {
    HEAPF32: Float32Array;
    _malloc(n: number): number;
    _free(p: number): void;
    _reassign_init(
        fftSize: number, hop: number,
        sampleRate: number, maxCols: number, numBins: number,
        minHz: number, framesPerCol: number,
    ): number;
    _reassign_reset(): void;
    _reassign_set_frames_per_col(framesPerCol: number): void;
    _reassign_process_frame(raw: number, frameIndex: number): number;
    _reassign_get_max_col_touched(): number;
};

const SAMPLE_RATE = 44100;
const MAX_COLS = 4000;
const NUM_BINS = 256;
const MIN_HZ = 20;

function getMod(): ReassignMod {
    return getInstance() as unknown as ReassignMod;
}

function freqToLogBand(hz: number, sampleRate = SAMPLE_RATE): number {
    const nyquist = sampleRate / 2;
    const logMin = Math.log(MIN_HZ);
    const logRange = Math.log(nyquist) - logMin;
    return Math.floor(((Math.log(hz) - logMin) / logRange) * NUM_BINS);
}

function gridSnapshot(gridPtr: number, cols: number): Float32Array {
    const mod = getMod();
    const off = gridPtr >> 2;
    // Copy out (not subarray) so HEAPF32 invalidation doesn't matter to caller.
    return new Float32Array(
        mod.HEAPF32.subarray(off, off + cols * NUM_BINS),
    );
}

function makeSine(freq: number, durationSec: number): Float32Array {
    const n = Math.floor(durationSec * SAMPLE_RATE);
    const out = new Float32Array(n);
    const w = (2 * Math.PI * freq) / SAMPLE_RATE;
    for (let i = 0; i < n; i++) out[i] = Math.sin(w * i);
    return out;
}

function makeChirp(f0: number, f1: number, durationSec: number): Float32Array {
    const n = Math.floor(durationSec * SAMPLE_RATE);
    const out = new Float32Array(n);
    // Linear sweep: phi(t) = 2π ∫ f(t) dt, f(t) = f0 + (f1 - f0) * t / T.
    const T = durationSec;
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const f = f0 + ((f1 - f0) * t) / T;
        const phi = 2 * Math.PI * (f0 * t + (((f1 - f0) * t * t) / (2 * T)));
        out[i] = Math.sin(phi);
        void f; // silence unused
    }
    return out;
}

function processSignal(
    signal: Float32Array,
    framesPerCol: number,
): { gridPtr: number; maxColTouched: number; framesEmitted: number } {
    const mod = getMod();
    const rawPtr = mod._malloc(FFT_SIZE * 4);
    try {
        const gridPtr = mod._reassign_init(
            FFT_SIZE, HOP, SAMPLE_RATE, MAX_COLS, NUM_BINS, MIN_HZ, framesPerCol,
        );
        if (!gridPtr) throw new Error("reassign_init returned 0");
        const buf = new Float32Array(FFT_SIZE);
        let frameIndex = 0;
        for (let start = 0; start + FFT_SIZE <= signal.length; start += HOP) {
            buf.set(signal.subarray(start, start + FFT_SIZE));
            mod.HEAPF32.set(buf, rawPtr >> 2);
            mod._reassign_process_frame(rawPtr, frameIndex);
            frameIndex++;
        }
        return {
            gridPtr,
            maxColTouched: mod._reassign_get_max_col_touched(),
            framesEmitted: frameIndex,
        };
    } finally {
        mod._free(rawPtr);
    }
}

function dominantBand(grid: Float32Array, col: number): { band: number; energy: number; total: number } {
    let best = -1;
    let bestE = 0;
    let total = 0;
    const off = col * NUM_BINS;
    for (let b = 0; b < NUM_BINS; b++) {
        const e = grid[off + b];
        total += e;
        if (e > bestE) {
            bestE = e;
            best = b;
        }
    }
    return { band: best, energy: bestE, total };
}

describe("reassignment kernel (WASM)", () => {
    it("silence produces an all-zero grid", () => {
        const sig = new Float32Array(SAMPLE_RATE); // 1 sec of zeros
        const { gridPtr, framesEmitted } = processSignal(sig, 1);
        expect(framesEmitted).toBeGreaterThan(0);
        const grid = gridSnapshot(gridPtr, framesEmitted + 2);
        let sum = 0;
        for (let i = 0; i < grid.length; i++) sum += grid[i];
        expect(sum).toBe(0);
    });

    it("1 kHz sine concentrates energy in the band corresponding to 1 kHz (±1)", () => {
        const sig = makeSine(1000, 2);
        const { gridPtr, framesEmitted } = processSignal(sig, 1);
        const grid = gridSnapshot(gridPtr, framesEmitted + 2);

        const expectedBand = freqToLogBand(1000);
        // Examine the middle 80% of columns (skip edges that may have less mass).
        const skip = Math.floor(framesEmitted * 0.1);
        let totalNear = 0;
        let totalAll = 0;
        for (let col = skip; col < framesEmitted - skip; col++) {
            const off = col * NUM_BINS;
            for (let b = 0; b < NUM_BINS; b++) {
                const e = grid[off + b];
                totalAll += e;
                if (Math.abs(b - expectedBand) <= 1) totalNear += e;
            }
        }
        expect(totalAll).toBeGreaterThan(0);
        const ratio = totalNear / totalAll;
        // Reassignment should pack >90% of mid-section energy into ±1 band.
        expect(ratio).toBeGreaterThan(0.9);

        // Dominant band per column matches expected band ±1.
        let mismatches = 0;
        for (let col = skip; col < framesEmitted - skip; col++) {
            const { band, energy } = dominantBand(grid, col);
            if (energy === 0) continue;
            if (Math.abs(band - expectedBand) > 1) mismatches++;
        }
        expect(mismatches).toBeLessThan(framesEmitted * 0.05);
    });

    it("linear chirp 200 → 8000 Hz: dominant band tracks the chirp ±2 bands over middle 80%", () => {
        const T = 4;
        const sig = makeChirp(200, 8000, T);
        const { gridPtr, framesEmitted } = processSignal(sig, 1);
        const grid = gridSnapshot(gridPtr, framesEmitted + 2);

        const skip = Math.floor(framesEmitted * 0.1);
        let okCount = 0;
        let evaluated = 0;
        for (let col = skip; col < framesEmitted - skip; col++) {
            const { band, energy } = dominantBand(grid, col);
            if (energy === 0) continue;
            // Time at the column centre (with framesPerCol=1, col == frame_index).
            const t = (col * HOP + HOP / 2) / SAMPLE_RATE;
            const f = 200 + ((8000 - 200) * t) / T;
            const expected = freqToLogBand(f);
            if (Math.abs(band - expected) <= 2) okCount++;
            evaluated++;
        }
        expect(evaluated).toBeGreaterThan(20);
        // Most columns should track the chirp.
        expect(okCount).toBeGreaterThan(evaluated * 0.85);
    });

    it("calibration: full-scale 1 kHz sine deposits ~387920 |X_h|² into its peak cell (±1%)", () => {
        const sig = makeSine(1000, 1); // 1 second
        const { gridPtr, framesEmitted } = processSignal(sig, 1);
        const grid = gridSnapshot(gridPtr, framesEmitted + 2);
        // Average peak-cell energy over middle 80% of columns.
        const skip = Math.floor(framesEmitted * 0.1);
        let sum = 0;
        let count = 0;
        for (let col = skip; col < framesEmitted - skip; col++) {
            let best = 0;
            for (let b = 0; b < NUM_BINS; b++) {
                const e = grid[col * NUM_BINS + b];
                if (e > best) best = e;
            }
            if (best > 0) {
                sum += best;
                count++;
            }
        }
        const avg = sum / count;
        // Pinned value 387920 matches the MAG_REF_ENERGY constant in
        // src/wasm/reassign.c and src/client/analysis/spectrogram.ts.
        expect(avg).toBeGreaterThan(387920 * 0.99);
        expect(avg).toBeLessThan(387920 * 1.01);
    });

    it("-60 dBFS sine renders well above the floor (colour index > 50/255)", () => {
        const amplitude = Math.pow(10, -60 / 20); // -60 dBFS
        const n = SAMPLE_RATE;
        const sig = new Float32Array(n);
        const w = (2 * Math.PI * 1000) / SAMPLE_RATE;
        for (let i = 0; i < n; i++) sig[i] = amplitude * Math.sin(w * i);

        const framesPerCol = 1;
        const { gridPtr, framesEmitted } = processSignal(sig, framesPerCol);
        const grid = gridSnapshot(gridPtr, framesEmitted + 2);
        const skip = Math.floor(framesEmitted * 0.1);

        // Find peak cell energy on the middle 80%.
        let peak = 0;
        for (let col = skip; col < framesEmitted - skip; col++) {
            for (let b = 0; b < NUM_BINS; b++) {
                const e = grid[col * NUM_BINS + b];
                if (e > peak) peak = e;
            }
        }

        // Apply the same render math as the production redraw.
        const FLOOR_DB = -100;
        const CEIL_DB = 0;
        const MAG_REF_ENERGY = 387920;
        const ref = framesPerCol * MAG_REF_ENERGY;
        const db = peak > 0 ? 10 * Math.log10(peak / ref) : FLOOR_DB;
        const t = (Math.max(FLOOR_DB, Math.min(CEIL_DB, db)) - FLOOR_DB) / (CEIL_DB - FLOOR_DB);
        const idx = Math.round(t * 255);
        expect(idx).toBeGreaterThan(50);
    });

    it("a single-sample impulse spreads broadband across frequency but localises to ±2 columns", () => {
        const sig = new Float32Array(SAMPLE_RATE);
        const impulseSample = Math.floor(SAMPLE_RATE * 0.5); // half second in
        sig[impulseSample] = 1;
        const { gridPtr, framesEmitted } = processSignal(sig, 1);
        const grid = gridSnapshot(gridPtr, framesEmitted + 2);

        // Column-by-column total energy.
        const colEnergy = new Float32Array(framesEmitted);
        let total = 0;
        for (let col = 0; col < framesEmitted; col++) {
            let s = 0;
            const off = col * NUM_BINS;
            for (let b = 0; b < NUM_BINS; b++) s += grid[off + b];
            colEnergy[col] = s;
            total += s;
        }
        expect(total).toBeGreaterThan(0);

        // Peak column should be near impulseSample / HOP.
        let peakCol = 0;
        for (let col = 1; col < framesEmitted; col++) {
            if (colEnergy[col] > colEnergy[peakCol]) peakCol = col;
        }
        const expectedCol = Math.floor(impulseSample / HOP);
        expect(Math.abs(peakCol - expectedCol)).toBeLessThanOrEqual(2);

        // Frequency spread should be broad: count bins receiving > 1% of peak band energy.
        let peakBin = 0;
        let peakBinE = 0;
        const peakOff = peakCol * NUM_BINS;
        for (let b = 0; b < NUM_BINS; b++) {
            if (grid[peakOff + b] > peakBinE) {
                peakBinE = grid[peakOff + b];
                peakBin = b;
            }
        }
        let occupied = 0;
        for (let b = 0; b < NUM_BINS; b++) {
            if (grid[peakOff + b] > peakBinE * 0.01) occupied++;
        }
        void peakBin;
        // Impulse spreads across many bands (>20% of NUM_BINS at >1% of peak).
        expect(occupied).toBeGreaterThan(NUM_BINS * 0.2);
    });
});
