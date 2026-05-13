import { describe, expect, it } from "vitest";
import {
    DURATION_TOLERANCE_S,
    shouldApplyFinalDuration,
} from "./duration-correction";

describe("shouldApplyFinalDuration", () => {
    it("applies when no initial duration was known", () => {
        expect(shouldApplyFinalDuration(null, false, 10)).toBe(true);
        expect(shouldApplyFinalDuration(null, true, 10)).toBe(true);
    });

    it("applies when initial duration was an estimate", () => {
        expect(shouldApplyFinalDuration(10.0, false, 10.1)).toBe(true);
        expect(shouldApplyFinalDuration(10.0, false, 10.0)).toBe(true);
    });

    it("skips when exact initial matches observed within tolerance", () => {
        expect(shouldApplyFinalDuration(10.0, true, 10.0)).toBe(false);
        expect(
            shouldApplyFinalDuration(10.0, true, 10.0 + DURATION_TOLERANCE_S / 2),
        ).toBe(false);
    });

    it("applies when exact initial disagrees beyond tolerance", () => {
        expect(
            shouldApplyFinalDuration(10.0, true, 10.0 + DURATION_TOLERANCE_S * 2),
        ).toBe(true);
        expect(
            shouldApplyFinalDuration(10.0, true, 10.0 - DURATION_TOLERANCE_S * 2),
        ).toBe(true);
    });

    it("rejects invalid observed values", () => {
        expect(shouldApplyFinalDuration(null, false, 0)).toBe(false);
        expect(shouldApplyFinalDuration(null, false, -1)).toBe(false);
        expect(shouldApplyFinalDuration(null, false, NaN)).toBe(false);
    });
});
