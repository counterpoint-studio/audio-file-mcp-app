import { describe, it, expect } from "vitest";
import { computeEffectiveBitrate } from "./effective-bitrate";

describe("computeEffectiveBitrate", () => {
    it("computes bits per second from bytes and duration", () => {
        // 192 kbps × 60s = 11_520_000 bits = 1_440_000 bytes
        expect(computeEffectiveBitrate(1_440_000, 60)).toBe(192_000);
    });

    it("returns undefined for non-positive duration", () => {
        expect(computeEffectiveBitrate(1000, 0)).toBeUndefined();
        expect(computeEffectiveBitrate(1000, -1)).toBeUndefined();
    });

    it("returns undefined for NaN/Infinity duration", () => {
        expect(computeEffectiveBitrate(1000, NaN)).toBeUndefined();
        expect(computeEffectiveBitrate(1000, Infinity)).toBeUndefined();
    });

    it("returns undefined for non-positive sizeBytes", () => {
        expect(computeEffectiveBitrate(0, 60)).toBeUndefined();
        expect(computeEffectiveBitrate(-100, 60)).toBeUndefined();
    });

    it("rounds to nearest integer bps", () => {
        // 1 byte over 3s = 8/3 = 2.67 → 3
        expect(computeEffectiveBitrate(1, 3)).toBe(3);
    });

    it("handles large file sizes without precision issues", () => {
        // 2 GB over 3600s
        const result = computeEffectiveBitrate(2_000_000_000, 3600);
        expect(result).toBe(Math.round((2_000_000_000 * 8) / 3600));
    });
});
