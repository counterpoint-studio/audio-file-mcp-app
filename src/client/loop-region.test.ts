import { describe, it, expect } from "vitest";
import { normalizeRegion, enforceLoop } from "./loop-region";

describe("normalizeRegion", () => {
    it("orders ascending pair as-is", () => {
        expect(normalizeRegion(0.2, 0.5)).toEqual({ start: 0.2, end: 0.5 });
    });
    it("swaps descending pair", () => {
        expect(normalizeRegion(0.7, 0.3)).toEqual({ start: 0.3, end: 0.7 });
    });
    it("clamps below 0", () => {
        expect(normalizeRegion(-0.1, 0.4)).toEqual({ start: 0, end: 0.4 });
    });
    it("clamps above 1", () => {
        expect(normalizeRegion(0.4, 1.7)).toEqual({ start: 0.4, end: 1 });
    });
    it("handles equal endpoints", () => {
        expect(normalizeRegion(0.5, 0.5)).toEqual({ start: 0.5, end: 0.5 });
    });
});

describe("enforceLoop", () => {
    it("returns null when inside the region", () => {
        expect(enforceLoop(2.5, 2, 4)).toBeNull();
    });
    it("returns loopStart when at or past loopEnd", () => {
        expect(enforceLoop(4, 2, 4)).toBe(2);
        expect(enforceLoop(5, 2, 4)).toBe(2);
    });
    it("returns loopStart when before loopStart", () => {
        expect(enforceLoop(1, 2, 4)).toBe(2);
    });
    it("returns null for degenerate region (end <= start)", () => {
        expect(enforceLoop(3, 4, 4)).toBeNull();
        expect(enforceLoop(3, 5, 4)).toBeNull();
    });
});
