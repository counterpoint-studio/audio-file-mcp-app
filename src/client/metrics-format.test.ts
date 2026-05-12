import { describe, it, expect } from "vitest";
import {
    PLACEHOLDER,
    formatCrest,
    formatDb,
    formatDbFromLinear,
    formatLu,
    formatLufs,
} from "./metrics-format";

describe("formatDbFromLinear", () => {
    it("full-scale (1.0) → 0.0 dB", () => {
        expect(formatDbFromLinear(1.0)).toBe("0.0 dB");
    });

    it("-20 dBFS sine peak amplitude (0.1) → -20.0 dB", () => {
        expect(formatDbFromLinear(0.1)).toBe("-20.0 dB");
    });

    it("-3 dBFS (~0.7079) → -3.0 dB", () => {
        expect(formatDbFromLinear(0.70794578)).toBe("-3.0 dB");
    });

    it("full-scale sine RMS (1/√2) → -3.0 dB", () => {
        expect(formatDbFromLinear(Math.SQRT1_2)).toBe("-3.0 dB");
    });

    it("zero linear → -∞", () => {
        expect(formatDbFromLinear(0)).toBe("-∞ dB");
    });

    it("non-finite linear → -∞", () => {
        expect(formatDbFromLinear(-Infinity)).toBe("-∞ dB");
    });

    it("NaN → placeholder", () => {
        expect(formatDbFromLinear(NaN)).toBe(PLACEHOLDER);
    });
});

describe("formatDb", () => {
    it("-23.0 → '-23.0 dB'", () => {
        expect(formatDb(-23.0)).toBe("-23.0 dB");
    });

    it("NaN → placeholder", () => {
        expect(formatDb(NaN)).toBe(PLACEHOLDER);
    });

    it("-Infinity → -∞", () => {
        expect(formatDb(-Infinity)).toBe("-∞ dB");
    });
});

describe("formatCrest", () => {
    it("sine peak/RMS (1.0, 1/√2) → '3.0 dB'", () => {
        expect(formatCrest(1.0, Math.SQRT1_2)).toBe("3.0 dB");
    });

    it("-20 dBFS sine (peak 0.1, RMS 0.1/√2) → '3.0 dB' (crest is amplitude-invariant)", () => {
        expect(formatCrest(0.1, 0.1 / Math.SQRT2)).toBe("3.0 dB");
    });

    it("constant signal (peak = RMS) → '0.0 dB'", () => {
        expect(formatCrest(0.5, 0.5)).toBe("0.0 dB");
    });

    it("zero RMS or peak → placeholder", () => {
        expect(formatCrest(0, 0)).toBe(PLACEHOLDER);
        expect(formatCrest(0.5, 0)).toBe(PLACEHOLDER);
        expect(formatCrest(0, 0.5)).toBe(PLACEHOLDER);
    });

    it("NaN inputs → placeholder", () => {
        expect(formatCrest(NaN, 0.5)).toBe(PLACEHOLDER);
        expect(formatCrest(0.5, NaN)).toBe(PLACEHOLDER);
    });
});

describe("formatLufs / formatLu", () => {
    it("LUFS finite value → formatted with unit", () => {
        expect(formatLufs(-23.0)).toBe("-23.0 LUFS");
    });

    it("LUFS -Infinity → -∞", () => {
        expect(formatLufs(-Infinity)).toBe("-∞ LUFS");
    });

    it("LUFS NaN → placeholder", () => {
        expect(formatLufs(NaN)).toBe(PLACEHOLDER);
    });

    it("LU finite value → formatted with unit", () => {
        expect(formatLu(7.5)).toBe("7.5 LU");
    });

    it("LU NaN → placeholder", () => {
        expect(formatLu(NaN)).toBe(PLACEHOLDER);
    });
});
