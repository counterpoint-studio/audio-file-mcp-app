import { describe, expect, it } from "vitest";
import {
    formatGridLabel,
    frequencyRange,
    frequencyToY,
    visibleGridFrequencies,
} from "./frequency-grid";

describe("formatGridLabel", () => {
    it("formats sub-kHz as Hz", () => {
        expect(formatGridLabel(100)).toBe("100Hz");
    });
    it("formats kHz", () => {
        expect(formatGridLabel(1000)).toBe("1kHz");
        expect(formatGridLabel(10000)).toBe("10kHz");
    });
});

describe("frequencyRange", () => {
    it("returns null for sampleRate <= 0", () => {
        expect(frequencyRange(0)).toBeNull();
        expect(frequencyRange(-1)).toBeNull();
    });
    it("returns the bin-floor minHz and nyquist maxHz for a typical sample rate", () => {
        const r = frequencyRange(48000);
        expect(r).not.toBeNull();
        // 48000 / FFT_SIZE (2048) = 23.4375, which exceeds the 20 Hz floor.
        expect(r!.minHz).toBeCloseTo(48000 / 2048, 5);
        expect(r!.maxHz).toBe(24000);
    });
    it("uses the 20 Hz floor when bin frequency falls below it", () => {
        // 32768 / 2048 = 16 Hz < 20, so minHz should clamp to 20.
        const r = frequencyRange(32768);
        expect(r).not.toBeNull();
        expect(r!.minHz).toBe(20);
    });
});

describe("frequencyToY", () => {
    it("maps minHz to the bottom and maxHz to the top", () => {
        const sr = 48000;
        const range = frequencyRange(sr)!;
        expect(frequencyToY(range.minHz, 100, sr)).toBeCloseTo(100, 5);
        expect(frequencyToY(range.maxHz, 100, sr)).toBeCloseTo(0, 5);
    });
    it("places 1 kHz on a log scale between min and max", () => {
        const y = frequencyToY(1000, 100, 48000);
        expect(y).not.toBeNull();
        expect(y! > 0 && y! < 100).toBe(true);
    });
    it("returns null for out-of-range frequencies", () => {
        expect(frequencyToY(10_000, 60, 8_000)).toBeNull();
    });
});

describe("visibleGridFrequencies", () => {
    it("includes all three targets at 48 kHz", () => {
        expect(visibleGridFrequencies(48_000)).toEqual([100, 1_000, 10_000]);
    });
    it("drops 10 kHz at 8 kHz sample rate", () => {
        expect(visibleGridFrequencies(8_000)).toEqual([100, 1_000]);
    });
});
