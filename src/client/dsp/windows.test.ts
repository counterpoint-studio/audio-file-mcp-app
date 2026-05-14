import { describe, it, expect } from "vitest";
import { makeHann, multiplyInto } from "./windows";

describe("makeHann", () => {
    it("returns a length-N array", () => {
        for (const N of [16, 64, 2048]) {
            expect(makeHann(N).length).toBe(N);
        }
    });

    it("endpoints are zero", () => {
        const N = 2048;
        const w = makeHann(N);
        expect(w[0]).toBeCloseTo(0, 10);
        expect(w[N - 1]).toBeCloseTo(0, 10);
    });

    it("centre value is 1", () => {
        const N = 2049; // odd so the exact centre is hit
        const w = makeHann(N);
        expect(w[(N - 1) / 2]).toBeCloseTo(1, 10);
    });

    it("matches the analytic Hann formula pointwise", () => {
        const N = 2048;
        const w = makeHann(N);
        for (let n = 0; n < N; n++) {
            const expected = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
            expect(w[n]).toBeCloseTo(expected, 7);
        }
    });

    it("is symmetric: w[n] === w[N-1-n]", () => {
        const N = 2048;
        const w = makeHann(N);
        for (let n = 0; n < N / 2; n++) {
            expect(w[n]).toBeCloseTo(w[N - 1 - n], 10);
        }
    });

    it("N=1 degenerate case returns [1]", () => {
        expect(Array.from(makeHann(1))).toEqual([1]);
    });
});

describe("multiplyInto", () => {
    it("pointwise multiplies src by win into out", () => {
        const src = Float32Array.from([1, 2, 3, 4]);
        const win = Float32Array.from([0.5, 0.25, 1, 2]);
        const out = new Float32Array(4);
        multiplyInto(src, win, out);
        expect(Array.from(out)).toEqual([0.5, 0.5, 3, 8]);
    });

    it("throws on length mismatch", () => {
        const src = new Float32Array(4);
        const win = new Float32Array(5);
        const out = new Float32Array(4);
        expect(() => multiplyInto(src, win, out)).toThrow();
    });
});
