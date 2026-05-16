import { describe, it, expect, vi } from "vitest";
import { createChunkedSourceOptions } from "./chunked-source";
import { createChunkStore } from "./chunk-store";
import { createChunkBus } from "./chunk-bus";

function blobOf(bytes: number[]): Blob {
    return new Blob([new Uint8Array(bytes)]);
}

async function callRead(
    opts: ReturnType<typeof createChunkedSourceOptions>,
    start: number,
    end: number,
): Promise<Uint8Array> {
    const result = await opts.read(start, end);
    if (result instanceof Uint8Array) return result;
    throw new Error("expected Uint8Array");
}

describe("createChunkedSourceOptions", () => {
    it("returns bytes directly when range is covered", async () => {
        const store = createChunkStore(10);
        store.add(0, blobOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
        const bus = createChunkBus();
        const loader = { request: vi.fn() };
        const opts = createChunkedSourceOptions({
            store,
            loader,
            onChunk: bus.subscribe,
        });

        const result = await callRead(opts, 2, 5);
        expect(Array.from(result)).toEqual([3, 4, 5]);
        expect(loader.request).not.toHaveBeenCalled();
    });

    it("getSize returns store totalSize", () => {
        const store = createChunkStore(1234);
        const bus = createChunkBus();
        const loader = { request: vi.fn() };
        const opts = createChunkedSourceOptions({
            store,
            loader,
            onChunk: bus.subscribe,
        });
        expect(opts.getSize()).toBe(1234);
    });

    it("requests gap and resolves after chunk arrives", async () => {
        const store = createChunkStore(20);
        const bus = createChunkBus();
        const loader = { request: vi.fn() };
        const opts = createChunkedSourceOptions({
            store,
            loader,
            onChunk: bus.subscribe,
        });

        const promise = callRead(opts, 5, 10);
        await new Promise<void>((r) => setTimeout(r, 0));
        expect(loader.request).toHaveBeenCalledWith(5, 10);

        store.add(0, blobOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
        bus.emit();

        const out = await promise;
        expect(Array.from(out)).toEqual([5, 6, 7, 8, 9]);
    });

    it("returns empty array for inverted or zero-length range", async () => {
        const store = createChunkStore(10);
        const bus = createChunkBus();
        const loader = { request: vi.fn() };
        const opts = createChunkedSourceOptions({
            store,
            loader,
            onChunk: bus.subscribe,
        });

        const a = await callRead(opts, 5, 5);
        const b = await callRead(opts, 7, 3);
        expect(a.length).toBe(0);
        expect(b.length).toBe(0);
        expect(loader.request).not.toHaveBeenCalled();
    });

    it("clamps past totalSize without calling loader", async () => {
        const store = createChunkStore(5);
        store.add(0, blobOf([10, 20, 30, 40, 50]));
        const bus = createChunkBus();
        const loader = { request: vi.fn() };
        const opts = createChunkedSourceOptions({
            store,
            loader,
            onChunk: bus.subscribe,
        });

        const out = await callRead(opts, 3, 100);
        expect(Array.from(out)).toEqual([40, 50]);
        expect(loader.request).not.toHaveBeenCalled();
    });

    it("waits across multiple emissions until coverage is complete", async () => {
        const store = createChunkStore(20);
        const bus = createChunkBus();
        const loader = { request: vi.fn() };
        const opts = createChunkedSourceOptions({
            store,
            loader,
            onChunk: bus.subscribe,
        });

        const promise = callRead(opts, 0, 8);
        await new Promise<void>((r) => setTimeout(r, 0));

        store.add(0, blobOf([0, 1, 2, 3]));
        bus.emit();

        let resolved = false;
        void promise.then(() => {
            resolved = true;
        });
        await new Promise<void>((r) => setTimeout(r, 0));
        expect(resolved).toBe(false);

        store.add(4, blobOf([4, 5, 6, 7]));
        bus.emit();

        const out = await promise;
        expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
});
