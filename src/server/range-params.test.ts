import { describe, it, expect } from "vitest";
import { asScalar, parseNonNegInt } from "./range-params";

describe("asScalar", () => {
    it("returns string as-is", () => {
        expect(asScalar("foo")).toBe("foo");
    });
    it("returns first element of array", () => {
        expect(asScalar(["a", "b"])).toBe("a");
    });
    it("returns null for empty array", () => {
        expect(asScalar([])).toBe(null);
    });
    it("returns null for undefined", () => {
        expect(asScalar(undefined)).toBe(null);
    });
    it("returns empty string when scalar is empty", () => {
        expect(asScalar("")).toBe("");
    });
});

describe("parseNonNegInt", () => {
    it("parses zero", () => {
        expect(parseNonNegInt("0")).toBe(0);
    });
    it("parses positive int", () => {
        expect(parseNonNegInt("12345")).toBe(12345);
    });
    it("rejects null", () => {
        expect(parseNonNegInt(null)).toBe(null);
    });
    it("rejects empty", () => {
        expect(parseNonNegInt("")).toBe(null);
    });
    it("rejects leading whitespace (strict)", () => {
        expect(parseNonNegInt(" 3")).toBe(null);
    });
    it("rejects trailing whitespace (strict)", () => {
        expect(parseNonNegInt("3 ")).toBe(null);
    });
    it("rejects negative", () => {
        expect(parseNonNegInt("-1")).toBe(null);
    });
    it("rejects non-integer", () => {
        expect(parseNonNegInt("3.5")).toBe(null);
    });
    it("rejects NaN-like", () => {
        expect(parseNonNegInt("abc")).toBe(null);
    });
    it("rejects exponent notation", () => {
        expect(parseNonNegInt("1e3")).toBe(null);
    });
    it("rejects very large (above MAX_SAFE_INTEGER)", () => {
        const big = "99999999999999999999";
        expect(parseNonNegInt(big)).toBe(null);
    });
    it("accepts the max-safe-int boundary", () => {
        expect(parseNonNegInt(String(Number.MAX_SAFE_INTEGER))).toBe(
            Number.MAX_SAFE_INTEGER,
        );
    });
});
