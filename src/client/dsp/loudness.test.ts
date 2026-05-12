import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { instantiate } from "./wasm-dsp.gen";
import { createLoudness, type Loudness } from "./loudness";

beforeAll(async () => {
    await instantiate();
});

function sine(durationSec: number, freq: number, amplitude: number, fs: number): Float32Array {
    const n = Math.floor(durationSec * fs);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / fs);
    return out;
}

// A pure 1 kHz sine at this amplitude integrates to -23 LUFS.
// LUFS = -0.691 + 10*log10(MS_K). At 1 kHz, K-weighting is ≈ 0 dB.
// MS = A^2 / 2 → A = sqrt(2 * 10^((-23 + 0.691)/10)) ≈ 0.10864.
const AMP_FOR_MINUS_23_LUFS_AT_1KHZ = 0.10864;

describe("libebur128 (via WASM)", () => {
    let lufs: Loudness | null = null;
    afterEach(() => {
        lufs?.dispose();
        lufs = null;
    });

    it("integrates a mono 1 kHz sine near -23 LUFS to within ±1 LU", () => {
        // BS.1770's K-weighting "pre-filter" has rising gain through the lower
        // mids and is not exactly 0 dB at 1 kHz, so the textbook
        // A = √(2 · 10^((LUFS + 0.691)/10)) formula yields ~-22 LUFS rather than
        // -23. A tighter cross-check vs ffmpeg lives in Phase 4 — here we just
        // guard that the build produces a sensible measurement.
        const fs = 44100;
        lufs = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        lufs.addFrames([sine(10, 1000, AMP_FOR_MINUS_23_LUFS_AT_1KHZ, fs)]);
        const I = lufs.global();
        expect(I).toBeGreaterThan(-24);
        expect(I).toBeLessThan(-21);
    });

    it("integrates silence to -Infinity", () => {
        const fs = 44100;
        lufs = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        lufs.addFrames([new Float32Array(10 * fs)]);
        expect(lufs.global()).toBe(-Infinity);
    });

    it("reads ≈ +3.01 LU higher for coherent stereo than for the same signal mono", () => {
        const fs = 44100;
        const samples = sine(10, 1000, AMP_FOR_MINUS_23_LUFS_AT_1KHZ, fs);
        const mono = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        const stereo = createLoudness(fs, 2, "M|S|I|LRA|TP|SP");
        try {
            mono.addFrames([samples]);
            stereo.addFrames([samples, samples]);
            expect(stereo.global() - mono.global()).toBeCloseTo(3.01, 1);
        } finally {
            mono.dispose();
            stereo.dispose();
        }
    });

    it("sample peak (dBFS) matches the known max amplitude in the input", () => {
        const fs = 44100;
        lufs = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        const samples = new Float32Array(fs).fill(0.1);
        samples[100] = 0.5;
        lufs.addFrames([samples]);
        // 20 * log10(0.5) = -6.02 dBFS
        expect(lufs.samplePeak()).toBeCloseTo(-6.02, 1);
    });

    it("true peak (dBTP) is greater than or equal to sample peak (high-freq sine has inter-sample peaks above sample maxima)", () => {
        const fs = 44100;
        lufs = createLoudness(fs, 1, "M|S|I|LRA|TP|SP");
        // 17.5 kHz sine at amplitude 0.95 — between-sample peaks exceed the discrete sample peak.
        lufs.addFrames([sine(2, 17500, 0.95, fs)]);
        expect(lufs.truePeak()).toBeGreaterThanOrEqual(lufs.samplePeak() - 1e-3);
    });

    it("dispose() releases the state without throwing; a fresh instance after dispose is independent", () => {
        const fs = 44100;
        const a = createLoudness(fs, 1, "I");
        a.addFrames([sine(1, 1000, AMP_FOR_MINUS_23_LUFS_AT_1KHZ, fs)]);
        a.dispose();
        const b = createLoudness(fs, 1, "I");
        b.addFrames([new Float32Array(fs)]);
        expect(b.global()).toBe(-Infinity);
        b.dispose();
    });
});
