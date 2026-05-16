import { describe, it, expect } from "vitest";
import { createChunkStore } from "./chunk-store";

function blobOf(bytes: number[]): Blob {
    return new Blob([new Uint8Array(bytes)]);
}

describe("createChunkStore", () => {
    it("rejects negative or non-integer totalSize", () => {
        expect(() => createChunkStore(-1)).toThrow();
        expect(() => createChunkStore(1.5)).toThrow();
    });

    describe("add()", () => {
        it("accepts non-overlapping chunks in any order and keeps them sorted", () => {
            const s = createChunkStore(20);
            s.add(10, blobOf([1, 2, 3]));
            s.add(0, blobOf([4, 5, 6]));
            s.add(5, blobOf([7, 8]));
            // Coverage check: [0,3) + [5,7) + [10,13)
            expect(s.gaps(0, 20)).toEqual([
                [3, 5],
                [7, 10],
                [13, 20],
            ]);
        });

        it("rejects overlap with previous chunk", () => {
            const s = createChunkStore(20);
            s.add(0, blobOf([1, 2, 3, 4]));
            expect(() => s.add(2, blobOf([9]))).toThrow();
        });

        it("rejects overlap with next chunk", () => {
            const s = createChunkStore(20);
            s.add(5, blobOf([1, 2, 3]));
            expect(() => s.add(0, blobOf([9, 9, 9, 9, 9, 9]))).toThrow();
        });

        it("rejects adding past totalSize", () => {
            const s = createChunkStore(5);
            expect(() => s.add(3, blobOf([1, 2, 3]))).toThrow();
        });

        it("allows adjacent chunks (touching but not overlapping)", () => {
            const s = createChunkStore(10);
            s.add(0, blobOf([1, 2, 3]));
            s.add(3, blobOf([4, 5, 6]));
            expect(s.isLoaded(0, 6)).toBe(true);
        });
    });

    describe("isLoaded()", () => {
        it("true for empty/inverted range", () => {
            const s = createChunkStore(10);
            expect(s.isLoaded(5, 5)).toBe(true);
            expect(s.isLoaded(7, 3)).toBe(true);
        });

        it("true only when range is fully covered (single chunk)", () => {
            const s = createChunkStore(10);
            s.add(2, blobOf([1, 2, 3, 4]));
            expect(s.isLoaded(2, 6)).toBe(true);
            expect(s.isLoaded(3, 5)).toBe(true);
            expect(s.isLoaded(1, 6)).toBe(false);
            expect(s.isLoaded(2, 7)).toBe(false);
        });

        it("true when covered by adjacent chunks", () => {
            const s = createChunkStore(20);
            s.add(0, blobOf([1, 2, 3]));
            s.add(3, blobOf([4, 5, 6, 7]));
            expect(s.isLoaded(0, 7)).toBe(true);
            expect(s.isLoaded(1, 6)).toBe(true);
        });

        it("false when there's a gap", () => {
            const s = createChunkStore(20);
            s.add(0, blobOf([1, 2, 3]));
            s.add(5, blobOf([6, 7]));
            expect(s.isLoaded(0, 7)).toBe(false);
        });
    });

    describe("gaps()", () => {
        it("fully covered → no gaps", () => {
            const s = createChunkStore(10);
            s.add(0, blobOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
            expect(s.gaps(0, 10)).toEqual([]);
        });

        it("fully uncovered → one gap", () => {
            const s = createChunkStore(10);
            expect(s.gaps(0, 10)).toEqual([[0, 10]]);
        });

        it("gap at start", () => {
            const s = createChunkStore(10);
            s.add(3, blobOf([1, 2, 3, 4, 5, 6, 7]));
            expect(s.gaps(0, 10)).toEqual([[0, 3]]);
        });

        it("gap at middle", () => {
            const s = createChunkStore(10);
            s.add(0, blobOf([1, 2]));
            s.add(7, blobOf([1, 2, 3]));
            expect(s.gaps(0, 10)).toEqual([[2, 7]]);
        });

        it("gap at end", () => {
            const s = createChunkStore(10);
            s.add(0, blobOf([1, 2, 3, 4, 5, 6, 7]));
            expect(s.gaps(0, 10)).toEqual([[7, 10]]);
        });

        it("multiple gaps", () => {
            const s = createChunkStore(20);
            s.add(2, blobOf([1, 2]));
            s.add(8, blobOf([1, 2, 3]));
            s.add(15, blobOf([1]));
            expect(s.gaps(0, 20)).toEqual([
                [0, 2],
                [4, 8],
                [11, 15],
                [16, 20],
            ]);
        });

        it("clamps to totalSize", () => {
            const s = createChunkStore(10);
            expect(s.gaps(5, 100)).toEqual([[5, 10]]);
        });
    });

    describe("read()", () => {
        it("returns empty for inverted/empty range", async () => {
            const s = createChunkStore(10);
            const out = await s.read(5, 5);
            expect(out).toEqual(new Uint8Array(0));
        });

        it("reads within a single chunk", async () => {
            const s = createChunkStore(20);
            s.add(5, blobOf([10, 20, 30, 40, 50]));
            const out = await s.read(6, 9);
            expect(Array.from(out)).toEqual([20, 30, 40]);
        });

        it("reads across multiple chunks", async () => {
            const s = createChunkStore(20);
            s.add(0, blobOf([1, 2, 3]));
            s.add(3, blobOf([4, 5]));
            s.add(5, blobOf([6, 7, 8]));
            const out = await s.read(2, 7);
            expect(Array.from(out)).toEqual([3, 4, 5, 6, 7]);
        });

        it("clamps within totalSize", async () => {
            const s = createChunkStore(5);
            s.add(0, blobOf([1, 2, 3, 4, 5]));
            const out = await s.read(3, 100);
            expect(Array.from(out)).toEqual([4, 5]);
        });

        it("throws if range not fully covered", async () => {
            const s = createChunkStore(10);
            s.add(0, blobOf([1, 2, 3]));
            await expect(s.read(0, 5)).rejects.toThrow();
        });
    });
});
