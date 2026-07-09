import { describe, it, expect } from "vitest";
import {
    resolveLaneSpans,
    envelopeStops,
    activeLaneIndicesAt,
    laneActivityInRegion,
} from "./annotation-layout";
import type { AnnotationData } from "../shared/annotation-data";

describe("resolveLaneSpans", () => {
    it("returns an empty array for no spans", () => {
        expect(resolveLaneSpans([])).toEqual([]);
    });

    it("keeps a single full-duration span unchanged", () => {
        expect(resolveLaneSpans([{ start: 0, end: 180 }])).toEqual([
            { start: 0, end: 180 },
        ]);
    });

    it("truncates an overlapping span at the next span's start", () => {
        expect(
            resolveLaneSpans([
                { start: 0, end: 10 },
                { start: 5, end: 20 },
            ]),
        ).toEqual([
            { start: 0, end: 5 },
            { start: 5, end: 20 },
        ]);
    });

    it("de-duplicates spans with identical starts, keeping the first", () => {
        expect(
            resolveLaneSpans([
                { start: 0, end: 10 },
                { start: 0, end: 5 },
            ]),
        ).toEqual([{ start: 0, end: 10 }]);
    });

    it("sorts unordered spans before truncating", () => {
        expect(
            resolveLaneSpans([
                { start: 5, end: 20 },
                { start: 0, end: 10 },
            ]),
        ).toEqual([
            { start: 0, end: 5 },
            { start: 5, end: 20 },
        ]);
    });

    it("drops a span whose truncated length is zero or negative", () => {
        // Second span starts at the same point the first would truncate to,
        // and a contained span disappears entirely.
        expect(
            resolveLaneSpans([
                { start: 0, end: 100 },
                { start: 10, end: 12 },
                { start: 10.0000001, end: 50 },
            ]),
        ).toEqual([
            { start: 0, end: 10 },
            { start: 10, end: 10.0000001 },
            { start: 10.0000001, end: 50 },
        ]);
    });

    it("drops a zero-length input span", () => {
        expect(resolveLaneSpans([{ start: 5, end: 5 }])).toEqual([]);
    });
});

describe("envelopeStops", () => {
    it("returns [] for an absent envelope", () => {
        expect(envelopeStops(undefined, 10)).toEqual([]);
    });

    it("returns [] for an empty envelope", () => {
        expect(envelopeStops([], 10)).toEqual([]);
    });

    it("returns [] for non-positive duration", () => {
        expect(envelopeStops([{ time: 0, value: 1 }], 0)).toEqual([]);
        expect(envelopeStops([{ time: 0, value: 1 }], -5)).toEqual([]);
    });

    it("normalizes times to offsets over the duration", () => {
        expect(
            envelopeStops(
                [
                    { time: 0, value: 0 },
                    { time: 5, value: 0.5 },
                    { time: 10, value: 1 },
                ],
                10,
            ),
        ).toEqual([
            { offset: 0, opacity: 0 },
            { offset: 0.5, opacity: 0.5 },
            { offset: 1, opacity: 1 },
        ]);
    });

    it("clamps out-of-range times and opacities and sorts by offset", () => {
        expect(
            envelopeStops(
                [
                    { time: 20, value: 2 },
                    { time: 0, value: 0.25 },
                ],
                10,
            ),
        ).toEqual([
            { offset: 0, opacity: 0.25 },
            { offset: 1, opacity: 1 },
        ]);
    });
});

const data: AnnotationData = {
    lanes: [
        { label: "A", spans: [{ start: 0, end: 10 }] },
        { label: "B", spans: [{ start: 10, end: 20 }] },
        {
            label: "C",
            spans: [
                { start: 0, end: 5 },
                { start: 15, end: 25 },
            ],
        },
    ],
};

describe("activeLaneIndicesAt", () => {
    it("returns lanes whose span covers the time (half-open start)", () => {
        expect(activeLaneIndicesAt(data, 2)).toEqual([0, 2]);
    });

    it("treats the span end as exclusive and start as inclusive", () => {
        // At t=10: lane A's span [0,10) has ended (exclusive), lane B's [10,20)
        // has begun (inclusive).
        expect(activeLaneIndicesAt(data, 10)).toEqual([1]);
    });

    it("returns [] when no lane is active", () => {
        expect(activeLaneIndicesAt(data, 100)).toEqual([]);
    });
});

describe("laneActivityInRegion", () => {
    it("reports active/starting/ending within a region", () => {
        // Region [4,16]:
        //  - lane A [0,10): overlaps → active; ends at 10 ∈ [4,16] → ending.
        //  - lane B [10,20): overlaps → active; starts at 10 ∈ [4,16] → starting.
        //  - lane C [0,5)+[15,25): overlaps → active; start 15 ∈ region → starting; end 5 ∈ region → ending.
        const r = laneActivityInRegion(data, 4, 16);
        expect(r.active).toEqual([0, 1, 2]);
        expect(r.starting).toEqual([1, 2]);
        expect(r.ending).toEqual([0, 2]);
    });

    it("includes spans touching a region edge (inclusive boundaries)", () => {
        // Region [10,10]: lane B starts exactly at 10; lane A ends exactly at 10.
        const r = laneActivityInRegion(data, 10, 10);
        expect(r.active).toEqual([0, 1]);
        expect(r.starting).toEqual([1]);
        expect(r.ending).toEqual([0]);
    });

    it("normalizes a reversed region", () => {
        const forward = laneActivityInRegion(data, 4, 16);
        const reversed = laneActivityInRegion(data, 16, 4);
        expect(reversed).toEqual(forward);
    });

    it("returns empty arrays when the region misses every span", () => {
        const r = laneActivityInRegion(data, 30, 40);
        expect(r).toEqual({ active: [], starting: [], ending: [] });
    });
});
