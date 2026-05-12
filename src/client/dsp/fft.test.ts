import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { instantiate } from "./wasm-dsp.gen";
import { createFft, type Fft } from "./fft";

beforeAll(async () => {
    await instantiate();
});

function makeSine(n: number, freq: number, fs: number, amplitude = 1): Float32Array {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / fs);
    return out;
}

function argMax(a: Float32Array): number {
    let best = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
    return best;
}

describe("PFFFT (via WASM)", () => {
    let fft: Fft | null = null;
    afterEach(() => {
        fft?.dispose();
        fft = null;
    });

    it("puts the magnitude peak of a 1 kHz sine at the expected bin (N=2048, fs=44.1k)", () => {
        const N = 2048;
        const fs = 44100;
        fft = createFft(N);
        const mags = fft.magnitudes(makeSine(N, 1000, fs));
        expect(mags.length).toBe(N / 2);
        const expectedBin = Math.round((1000 * N) / fs);
        expect(argMax(mags)).toBe(expectedBin);
    });

    it("puts the peak of a 100 Hz sine in a low bin (±1)", () => {
        const N = 2048;
        const fs = 44100;
        fft = createFft(N);
        const mags = fft.magnitudes(makeSine(N, 100, fs));
        const expectedBin = Math.round((100 * N) / fs);
        const peakBin = argMax(mags);
        expect(Math.abs(peakBin - expectedBin)).toBeLessThanOrEqual(1);
    });

    it("returns ~zero magnitudes for silence", () => {
        const N = 2048;
        fft = createFft(N);
        const mags = fft.magnitudes(new Float32Array(N));
        for (const m of mags) expect(m).toBeCloseTo(0, 5);
    });

    it("magnitudes are non-negative and finite", () => {
        const N = 2048;
        fft = createFft(N);
        const mags = fft.magnitudes(makeSine(N, 1000, 44100));
        for (const m of mags) {
            expect(m).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(m)).toBe(true);
        }
    });

    it("survives many transforms without leaking heap (smoke check on heap stability)", () => {
        const N = 2048;
        fft = createFft(N);
        const input = makeSine(N, 1000, 44100);
        for (let i = 0; i < 1000; i++) fft.magnitudes(input);
        const mags = fft.magnitudes(input);
        expect(argMax(mags)).toBe(Math.round((1000 * N) / 44100));
    });
});
