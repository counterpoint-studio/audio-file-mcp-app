import { describe, it, expect } from "vitest";
import { GrowablePeaks } from "./growable-peaks";

describe("GrowablePeaks", () => {
    it("appends pairs and reads them back at the correct index", () => {
        const g = new GrowablePeaks(4);
        g.append(-0.5, 0.5);
        g.append(-0.1, 0.9);
        expect(g.count).toBe(2);
        expect(g.minAt(0)).toBeCloseTo(-0.5);
        expect(g.maxAt(0)).toBeCloseTo(0.5);
        expect(g.minAt(1)).toBeCloseTo(-0.1);
        expect(g.maxAt(1)).toBeCloseTo(0.9);
    });

    it("doubles capacity on overflow without losing values", () => {
        const g = new GrowablePeaks(2);
        for (let i = 0; i < 10; i++) g.append(-i, i);
        expect(g.count).toBe(10);
        for (let i = 0; i < 10; i++) {
            expect(g.minAt(i)).toBeCloseTo(-i);
            expect(g.maxAt(i)).toBeCloseTo(i);
        }
    });

    it("enforces a sane minimum initial capacity", () => {
        const g = new GrowablePeaks(0);
        expect(() => g.append(0, 0)).not.toThrow();
        expect(g.count).toBe(1);
    });
});
