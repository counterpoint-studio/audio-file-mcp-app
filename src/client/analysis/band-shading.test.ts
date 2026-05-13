import { describe, it, expect } from "vitest";
import { bandEnergyToFillStyle } from "./band-shading";

describe("bandEnergyToFillStyle", () => {
    it("returns the default ink colour for silence", () => {
        expect(bandEnergyToFillStyle({ low: 0, mid: 0, high: 0 })).toBe("#111");
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
        // centroid ~0.25 (heavy low, some mid) — should be darker than mid grey.
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
        expect(bandEnergyToFillStyle({ low: -0, mid: 0, high: 0 })).toBe("#111");
    });
});
