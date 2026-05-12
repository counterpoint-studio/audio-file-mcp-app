import { describe, it, expect } from "vitest";
import { TimeSeriesStore, TIMESERIES_HZ } from "./time-series";

describe("TimeSeriesStore", () => {
    it("starts empty", () => {
        const s = new TimeSeriesStore();
        expect(s.count).toBe(0);
    });

    it("append writes samplePeak / rms / clipping and leaves later-phase columns as NaN", () => {
        const s = new TimeSeriesStore();
        s.append(0.5, 0.3, 2);
        expect(s.count).toBe(1);
        expect(s.samplePeak[0]).toBeCloseTo(0.5);
        expect(s.rms[0]).toBeCloseTo(0.3);
        expect(s.clipping[0]).toBe(2);
        expect(Number.isNaN(s.truePeak[0])).toBe(true);
        expect(Number.isNaN(s.momentary[0])).toBe(true);
        expect(Number.isNaN(s.shortTerm[0])).toBe(true);
    });

    it("setAt writes into the specified column at the specified index, leaving siblings alone", () => {
        const s = new TimeSeriesStore();
        s.append(0.5, 0.3, 0);
        s.append(0.6, 0.4, 1);
        s.setAt(1, "momentary", -18.0);
        s.setAt(0, "shortTerm", -22.5);
        s.setAt(1, "truePeak", -0.5);
        expect(s.momentary[1]).toBeCloseTo(-18.0);
        expect(s.shortTerm[0]).toBeCloseTo(-22.5);
        expect(s.truePeak[1]).toBeCloseTo(-0.5);
        expect(Number.isNaN(s.momentary[0])).toBe(true);
        expect(Number.isNaN(s.shortTerm[1])).toBe(true);
        expect(Number.isNaN(s.truePeak[0])).toBe(true);
    });

    it("grows all parallel arrays on overflow without losing previously written values", () => {
        const s = new TimeSeriesStore(4);
        for (let i = 0; i < 20; i++) s.append(i * 0.01, i * 0.005, i);
        expect(s.count).toBe(20);
        for (let i = 0; i < 20; i++) {
            expect(s.samplePeak[i]).toBeCloseTo(i * 0.01);
            expect(s.rms[i]).toBeCloseTo(i * 0.005);
            expect(s.clipping[i]).toBe(i);
        }
        s.setAt(15, "momentary", -10.0);
        expect(s.momentary[15]).toBeCloseTo(-10.0);
    });

    it("indexAtSeconds maps time to step index at TIMESERIES_HZ (10 → 100 ms steps)", () => {
        expect(TIMESERIES_HZ).toBe(10);
        const s = new TimeSeriesStore();
        for (let i = 0; i < 20; i++) s.append(0, 0, 0);
        expect(s.indexAtSeconds(0)).toBe(0);
        expect(s.indexAtSeconds(0.05)).toBe(0);
        expect(s.indexAtSeconds(0.1)).toBe(1);
        expect(s.indexAtSeconds(1.0)).toBe(10);
        expect(s.indexAtSeconds(1.95)).toBe(19);
    });

    it("indexAtSeconds clamps negative to 0 and beyond-end to count-1", () => {
        const s = new TimeSeriesStore();
        for (let i = 0; i < 10; i++) s.append(0, 0, 0);
        expect(s.indexAtSeconds(-5)).toBe(0);
        expect(s.indexAtSeconds(1000)).toBe(9);
    });

    it("indexAtSeconds returns -1 when the store is empty (sentinel for callers)", () => {
        const s = new TimeSeriesStore();
        expect(s.indexAtSeconds(1.5)).toBe(-1);
    });
});
