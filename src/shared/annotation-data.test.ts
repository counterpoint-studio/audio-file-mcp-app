import { describe, it, expect } from "vitest";
import {
    annotationDataSchema,
    parseAnnotationData,
} from "./annotation-data";

describe("annotationDataSchema", () => {
    it("accepts a minimal valid payload", () => {
        const r = annotationDataSchema.safeParse({ lanes: [] });
        expect(r.success).toBe(true);
    });

    it("accepts a lane with color, envelope, and spans", () => {
        const r = annotationDataSchema.safeParse({
            lanes: [
                {
                    label: "Warm Pad",
                    color: "#ff8800",
                    spans: [{ start: 0, end: 10 }],
                    envelope: [
                        { time: 0, value: 0 },
                        { time: 10, value: 1 },
                    ],
                },
            ],
        });
        expect(r.success).toBe(true);
    });

    it("rejects a negative span start", () => {
        const r = annotationDataSchema.safeParse({
            lanes: [{ spans: [{ start: -1, end: 5 }] }],
        });
        expect(r.success).toBe(false);
    });

    it("tolerates end < start at the schema level (truncation handles ordering)", () => {
        const r = annotationDataSchema.safeParse({
            lanes: [{ spans: [{ start: 10, end: 5 }] }],
        });
        expect(r.success).toBe(true);
    });

    it("rejects an envelope value out of [0,1]", () => {
        const r = annotationDataSchema.safeParse({
            lanes: [
                {
                    spans: [],
                    envelope: [{ time: 0, value: 1.5 }],
                },
            ],
        });
        expect(r.success).toBe(false);
    });

    it("rejects a non-array lanes field", () => {
        const r = annotationDataSchema.safeParse({ lanes: "nope" });
        expect(r.success).toBe(false);
    });

    it("strips unknown keys but still parses", () => {
        const r = annotationDataSchema.safeParse({
            lanes: [{ spans: [], somethingElse: true }],
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.lanes[0]).not.toHaveProperty("somethingElse");
        }
    });

    it("rejects a non-finite span end", () => {
        const r = annotationDataSchema.safeParse({
            lanes: [{ spans: [{ start: 0, end: Infinity }] }],
        });
        expect(r.success).toBe(false);
    });
});

describe("parseAnnotationData", () => {
    it("returns the data for a valid payload", () => {
        const out = parseAnnotationData({ lanes: [{ spans: [] }] });
        expect(out).toEqual({ lanes: [{ spans: [] }] });
    });

    it("returns null for null", () => {
        expect(parseAnnotationData(null)).toBeNull();
    });

    it("returns null for an invalid payload", () => {
        expect(parseAnnotationData({ lanes: 5 })).toBeNull();
    });
});
