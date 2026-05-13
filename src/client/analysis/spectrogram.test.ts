import { describe, it, expect } from "vitest";
import { makeColorLut } from "./spectrogram";

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
