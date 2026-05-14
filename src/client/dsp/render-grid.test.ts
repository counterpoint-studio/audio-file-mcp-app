import { describe, it, expect, beforeAll } from "vitest";
import { instantiate } from "./wasm-dsp.gen";
import { createGridRenderer } from "./render-grid";

beforeAll(async () => {
    await instantiate();
});

function makeLut(): Uint8ClampedArray {
    // Simple deterministic LUT: red = idx, green = 255 - idx, blue = idx / 2, alpha = 255.
    const lut = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
        lut[i * 4 + 0] = i;
        lut[i * 4 + 1] = 255 - i;
        lut[i * 4 + 2] = i >> 1;
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

const FLOOR_DB = -100;
const CEIL_DB = 0;
const MAG_REF = 512;
const FLOOR_MAG = MAG_REF * Math.pow(10, FLOOR_DB / 20);

function renderJs(
    grid: Float32Array,
    cols: number,
    numBins: number,
    lut: Uint8ClampedArray,
): Uint8ClampedArray {
    const buf = new Uint8ClampedArray(cols * numBins * 4);
    const range = CEIL_DB - FLOOR_DB;
    for (let col = 0; col < cols; col++) {
        const srcOff = col * numBins;
        for (let b = 0; b < numBins; b++) {
            const mag = grid[srcOff + b];
            let db = mag > FLOOR_MAG ? 20 * Math.log10(mag / MAG_REF) : FLOOR_DB;
            if (db < FLOOR_DB) db = FLOOR_DB;
            if (db > CEIL_DB) db = CEIL_DB;
            const t = (db - FLOOR_DB) / range;
            const li = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
            const y = numBins - 1 - b;
            const dstOff = (y * cols + col) * 4;
            buf[dstOff + 0] = lut[li + 0];
            buf[dstOff + 1] = lut[li + 1];
            buf[dstOff + 2] = lut[li + 2];
            buf[dstOff + 3] = lut[li + 3];
        }
    }
    return buf;
}

describe("render_grid_to_rgba (WASM)", () => {
    const lut = makeLut();

    it("black input (all zeros) renders as LUT entry 0 everywhere", () => {
        const cols = 8;
        const numBins = 16;
        const grid = new Float32Array(cols * numBins);
        const out = new Uint8ClampedArray(cols * numBins * 4);
        const renderer = createGridRenderer(lut);
        try {
            renderer.render({
                grid, decodedCols: cols, numBins,
                floorDb: FLOOR_DB, ceilDb: CEIL_DB,
                magRef: MAG_REF, floorMag: FLOOR_MAG,
                out,
            });
        } finally {
            renderer.dispose();
        }
        for (let i = 0; i < cols * numBins; i++) {
            expect(out[i * 4 + 0]).toBe(lut[0]);
            expect(out[i * 4 + 1]).toBe(lut[1]);
            expect(out[i * 4 + 2]).toBe(lut[2]);
            expect(out[i * 4 + 3]).toBe(lut[3]);
        }
    });

    it("peak input (mag = MAG_REF) renders as LUT entry 255 everywhere", () => {
        const cols = 4;
        const numBins = 8;
        const grid = new Float32Array(cols * numBins);
        grid.fill(MAG_REF);
        const out = new Uint8ClampedArray(cols * numBins * 4);
        const renderer = createGridRenderer(lut);
        try {
            renderer.render({
                grid, decodedCols: cols, numBins,
                floorDb: FLOOR_DB, ceilDb: CEIL_DB,
                magRef: MAG_REF, floorMag: FLOOR_MAG,
                out,
            });
        } finally {
            renderer.dispose();
        }
        for (let i = 0; i < cols * numBins; i++) {
            expect(out[i * 4 + 0]).toBe(lut[255 * 4 + 0]);
            expect(out[i * 4 + 1]).toBe(lut[255 * 4 + 1]);
            expect(out[i * 4 + 2]).toBe(lut[255 * 4 + 2]);
            expect(out[i * 4 + 3]).toBe(lut[255 * 4 + 3]);
        }
    });

    it("midrange input (-50 dB) renders within ±1 of LUT entry 128", () => {
        const cols = 4;
        const numBins = 8;
        const grid = new Float32Array(cols * numBins);
        const mag = MAG_REF * Math.pow(10, -50 / 20); // -50 dB
        grid.fill(mag);
        const out = new Uint8ClampedArray(cols * numBins * 4);
        const renderer = createGridRenderer(lut);
        try {
            renderer.render({
                grid, decodedCols: cols, numBins,
                floorDb: FLOOR_DB, ceilDb: CEIL_DB,
                magRef: MAG_REF, floorMag: FLOOR_MAG,
                out,
            });
        } finally {
            renderer.dispose();
        }
        // 50/100 → t = 0.5 → idx = 128.
        const expectedIdx = 128;
        for (let i = 0; i < cols * numBins; i++) {
            expect(Math.abs(out[i * 4 + 0] - lut[expectedIdx * 4 + 0])).toBeLessThanOrEqual(1);
            expect(Math.abs(out[i * 4 + 1] - lut[expectedIdx * 4 + 1])).toBeLessThanOrEqual(1);
            expect(Math.abs(out[i * 4 + 2] - lut[expectedIdx * 4 + 2])).toBeLessThanOrEqual(1);
            expect(out[i * 4 + 3]).toBe(255);
        }
    });

    it("row 0 of output (image-top) corresponds to bin numBins-1 (highest frequency)", () => {
        const cols = 4;
        const numBins = 8;
        const grid = new Float32Array(cols * numBins);
        // Put MAG_REF only in bin numBins-1, zeros elsewhere
        for (let c = 0; c < cols; c++) {
            grid[c * numBins + (numBins - 1)] = MAG_REF;
        }
        const out = new Uint8ClampedArray(cols * numBins * 4);
        const renderer = createGridRenderer(lut);
        try {
            renderer.render({
                grid, decodedCols: cols, numBins,
                floorDb: FLOOR_DB, ceilDb: CEIL_DB,
                magRef: MAG_REF, floorMag: FLOOR_MAG,
                out,
            });
        } finally {
            renderer.dispose();
        }
        // Row 0 (top) should be peak colour.
        for (let c = 0; c < cols; c++) {
            const off = (0 * cols + c) * 4;
            expect(out[off + 0]).toBe(lut[255 * 4 + 0]);
        }
        // Row numBins-1 (bottom) should be floor colour.
        for (let c = 0; c < cols; c++) {
            const off = ((numBins - 1) * cols + c) * 4;
            expect(out[off + 0]).toBe(lut[0]);
        }
    });

    it("matches the JS reference renderer within ±1 per channel on a randomized grid", () => {
        const cols = 32;
        const numBins = 64;
        const grid = new Float32Array(cols * numBins);
        // Spread magnitudes log-uniformly across [FLOOR_MAG/10, MAG_REF*2].
        let seed = 0xc0ffee;
        const rand = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        for (let i = 0; i < grid.length; i++) {
            const t = rand();
            grid[i] = Math.pow(10, -6 + 7 * t) * MAG_REF; // ~ -120 dB to +20 dB
        }
        const out = new Uint8ClampedArray(cols * numBins * 4);
        const renderer = createGridRenderer(lut);
        try {
            renderer.render({
                grid, decodedCols: cols, numBins,
                floorDb: FLOOR_DB, ceilDb: CEIL_DB,
                magRef: MAG_REF, floorMag: FLOOR_MAG,
                out,
            });
        } finally {
            renderer.dispose();
        }
        const ref = renderJs(grid, cols, numBins, lut);
        let maxDiff = 0;
        for (let i = 0; i < out.length; i++) {
            const d = Math.abs(out[i] - ref[i]);
            if (d > maxDiff) maxDiff = d;
        }
        expect(maxDiff).toBeLessThanOrEqual(1);
    });

    it("input below FLOOR_MAG clamps to FLOOR_DB colour", () => {
        const cols = 2;
        const numBins = 4;
        const grid = new Float32Array(cols * numBins);
        grid.fill(FLOOR_MAG * 0.5); // below floor
        const out = new Uint8ClampedArray(cols * numBins * 4);
        const renderer = createGridRenderer(lut);
        try {
            renderer.render({
                grid, decodedCols: cols, numBins,
                floorDb: FLOOR_DB, ceilDb: CEIL_DB,
                magRef: MAG_REF, floorMag: FLOOR_MAG,
                out,
            });
        } finally {
            renderer.dispose();
        }
        for (let i = 0; i < cols * numBins; i++) {
            expect(out[i * 4 + 0]).toBe(lut[0]);
            expect(out[i * 4 + 1]).toBe(lut[1]);
            expect(out[i * 4 + 2]).toBe(lut[2]);
        }
    });
});
