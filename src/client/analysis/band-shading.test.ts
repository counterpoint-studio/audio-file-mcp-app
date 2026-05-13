import { describe, it, expect } from "vitest";
import { bandEnergyToFillStyle, waveformPalette } from "./band-shading";

describe("bandEnergyToFillStyle (light palette, default)", () => {
    it("returns the fallback colour for silence", () => {
        expect(bandEnergyToFillStyle({ low: 0, mid: 0, high: 0 })).toBe(
            "#111111",
        );
    });

    it("returns the darkest gray for pure low-band energy", () => {
        expect(bandEnergyToFillStyle({ low: 1, mid: 0, high: 0 })).toBe(
            "#1a1a1a",
        );
    });

    it("returns the lightest gray for pure high-band energy", () => {
        expect(bandEnergyToFillStyle({ low: 0, mid: 0, high: 1 })).toBe(
            "#aaaaaa",
        );
    });

    it("returns the midpoint gray for pure mid-band energy", () => {
        const result = bandEnergyToFillStyle({ low: 0, mid: 1, high: 0 });
        // centroid = 0.5 → 0x1a + 0.5 * (0xaa - 0x1a) = 0x62
        expect(result).toBe("#626262");
    });

    it("returns the same colour for balanced bands as for pure mids (centroid 0.5)", () => {
        const mids = bandEnergyToFillStyle({ low: 0, mid: 1, high: 0 });
        const balanced = bandEnergyToFillStyle({ low: 1, mid: 1, high: 1 });
        expect(balanced).toBe(mids);
    });

    it("scales linearly between dark and light along the centroid axis", () => {
        const lowMid = bandEnergyToFillStyle({ low: 3, mid: 1, high: 0 });
        const mid = bandEnergyToFillStyle({ low: 0, mid: 1, high: 0 });
        const midHigh = bandEnergyToFillStyle({ low: 0, mid: 1, high: 3 });

        const channel = (c: string) => parseInt(c.slice(1, 3), 16);
        expect(channel(lowMid)).toBeLessThan(channel(mid));
        expect(channel(midHigh)).toBeGreaterThan(channel(mid));
    });

    it("returns a 6-character hex with all three channels identical (grayscale)", () => {
        const c = bandEnergyToFillStyle({ low: 1, mid: 2, high: 1 });
        expect(c).toMatch(/^#([0-9a-f]{2})\1\1$/);
    });

    it("ignores negative tiny floating-point sums via the total<=0 guard", () => {
        expect(bandEnergyToFillStyle({ low: -0, mid: 0, high: 0 })).toBe(
            "#111111",
        );
    });
});

describe("bandEnergyToFillStyle (dark palette)", () => {
    const dark = waveformPalette("dark");

    it("returns the fallback colour for silence", () => {
        expect(bandEnergyToFillStyle({ low: 0, mid: 0, high: 0 }, dark)).toBe(
            "#eeeeee",
        );
    });

    it("returns the brightest gray for pure low-band energy", () => {
        expect(bandEnergyToFillStyle({ low: 1, mid: 0, high: 0 }, dark)).toBe(
            "#e5e5e5",
        );
    });

    it("returns the dimmest gray for pure high-band energy", () => {
        expect(bandEnergyToFillStyle({ low: 0, mid: 0, high: 1 }, dark)).toBe(
            "#555555",
        );
    });

    it("returns the midpoint gray for pure mid-band energy", () => {
        // centroid = 0.5 → 0xe5 + 0.5 * (0x55 - 0xe5) = 0x9d
        expect(bandEnergyToFillStyle({ low: 0, mid: 1, high: 0 }, dark)).toBe(
            "#9d9d9d",
        );
    });

    it("inverts centroid ordering vs light palette", () => {
        const lowHeavy = bandEnergyToFillStyle({ low: 3, mid: 1, high: 0 }, dark);
        const mid = bandEnergyToFillStyle({ low: 0, mid: 1, high: 0 }, dark);
        const highHeavy = bandEnergyToFillStyle(
            { low: 0, mid: 1, high: 3 },
            dark,
        );
        const channel = (c: string) => parseInt(c.slice(1, 3), 16);
        // bass-heavy should be brighter than mid; treble-heavy dimmer than mid.
        expect(channel(lowHeavy)).toBeGreaterThan(channel(mid));
        expect(channel(highHeavy)).toBeLessThan(channel(mid));
    });

    it("returns a 6-character grayscale hex", () => {
        const c = bandEnergyToFillStyle({ low: 1, mid: 2, high: 1 }, dark);
        expect(c).toMatch(/^#([0-9a-f]{2})\1\1$/);
    });
});

describe("waveformPalette", () => {
    it("returns the light palette for light theme", () => {
        expect(waveformPalette("light").fallback).toBe("#111111");
        expect(waveformPalette("light").placeholder).toBe("#bbbbbb");
    });

    it("returns the dark palette for dark theme", () => {
        expect(waveformPalette("dark").fallback).toBe("#eeeeee");
        expect(waveformPalette("dark").placeholder).toBe("#444444");
    });

    it("returns the same instance for repeated calls (palette identity)", () => {
        expect(waveformPalette("light")).toBe(waveformPalette("light"));
        expect(waveformPalette("dark")).toBe(waveformPalette("dark"));
    });
});
