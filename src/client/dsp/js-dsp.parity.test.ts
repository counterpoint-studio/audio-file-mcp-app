import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
    instantiate,
    getBackend,
    __resetForTests,
    __setFactoriesForTests,
} from "./dsp-loader";
import { createJsDsp } from "./js-dsp.gen";
import { createFft, type Fft } from "./fft";
import { createLoudness, type Loudness } from "./loudness";

// Force the loader onto the JS (asm.js) backend by giving it a throwing WASM
// factory + the real JS factory. The rest of the file exercises the same
// numeric paths the WASM-backed fft.test.ts / loudness.test.ts cover, so any
// JS-side regression in the asm.js codegen shows up here.

beforeAll(async () => {
    __resetForTests();
    __setFactoriesForTests(
        async () => {
            throw new Error("forced — parity test");
        },
        createJsDsp as (opts: Record<string, unknown>) => Promise<unknown>,
    );
    await instantiate();
});

function sine(n: number, freq: number, fs: number, amplitude = 1): Float32Array {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / fs);
    return out;
}

function argMax(a: Float32Array): number {
    let best = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
    return best;
}

describe("JS backend selected", () => {
    it("getBackend() reports 'js'", () => {
        expect(getBackend()).toBe("js");
    });
});

describe("PFFFT parity via JS backend", () => {
    let fft: Fft | null = null;
    afterEach(() => {
        fft?.dispose();
        fft = null;
    });

    it("puts the magnitude peak of a 1 kHz sine at the expected bin (N=2048, fs=44.1k)", () => {
        const N = 2048;
        const fs = 44100;
        fft = createFft(N);
        const mags = fft.magnitudes(sine(N, 1000, fs));
        const expectedBin = Math.round((1000 * N) / fs);
        expect(argMax(mags)).toBe(expectedBin);
    });

    it("returns ~zero magnitudes for silence", () => {
        const N = 2048;
        fft = createFft(N);
        const mags = fft.magnitudes(new Float32Array(N));
        for (const m of mags) expect(m).toBeCloseTo(0, 5);
    });
});

// Same -23-LUFS-target amplitude as the WASM-backed test; cross-backend
// agreement is the point of this file.
const AMP_FOR_MINUS_23_LUFS_AT_1KHZ = 0.10864;

describe("libebur128 parity via JS backend", () => {
    let lufs: Loudness | null = null;
    afterEach(() => {
        lufs?.dispose();
        lufs = null;
    });

    it("integrates a mono 1 kHz sine inside the same ±1 LU window as the WASM build", () => {
        const fs = 44100;
        lufs = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        lufs.addFrames([sine(10 * fs, 1000, fs, AMP_FOR_MINUS_23_LUFS_AT_1KHZ)]);
        const I = lufs.global();
        // WASM-backed assertion is (-24, -21); use the same window — the two
        // backends must agree to within 0.2 LU, so the same envelope passes
        // both.
        expect(I).toBeGreaterThan(-24);
        expect(I).toBeLessThan(-21);
    });

    it("integrates silence to -Infinity", () => {
        const fs = 44100;
        lufs = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        lufs.addFrames([new Float32Array(10 * fs)]);
        expect(lufs.global()).toBe(-Infinity);
    });
});
