import { describe, it, expect } from "vitest";
import { createChunkLoader } from "./chunk-loader";
import { createChunkStore, type ChunkStore } from "./chunk-store";

function makeControlledFetcher() {
    type Call = {
        start: number;
        length: number;
        resolve: (bytes: Uint8Array) => void;
        reject: (e: unknown) => void;
    };
    const pending: Call[] = [];
    const calls: Array<{ start: number; length: number }> = [];
    const fetcher = (start: number, length: number) =>
        new Promise<Uint8Array>((resolve, reject) => {
            calls.push({ start, length });
            pending.push({ start, length, resolve, reject });
        });
    function resolveAll(builder: (start: number, length: number) => Uint8Array) {
        const snapshot = pending.splice(0);
        for (const p of snapshot) p.resolve(builder(p.start, p.length));
    }
    function resolveFirst(builder: (start: number, length: number) => Uint8Array) {
        const p = pending.shift();
        if (!p) throw new Error("no pending fetch");
        p.resolve(builder(p.start, p.length));
    }
    return { fetcher, calls, pending, resolveAll, resolveFirst };
}

function bytesFor(start: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = (start + i) & 0xff;
    return out;
}

async function flush() {
    // Run a few microtask + macrotask ticks to settle the loader pipeline.
    for (let i = 0; i < 5; i++) {
        await new Promise<void>((r) => setTimeout(r, 0));
    }
}

function makeStore(total: number): ChunkStore {
    return createChunkStore(total);
}

describe("createChunkLoader", () => {
    it("sequential pump enqueues chunks in order, respects concurrency", async () => {
        const store = makeStore(10 * 100);
        const { fetcher, calls, pending } = makeControlledFetcher();
        createChunkLoader(store, {
            path: "/x",
            totalSize: 1000,
            chunkBytes: 100,
            concurrency: 3,
            fetcher,
            onChunk: (start, blob) => store.add(start, blob),
        });

        await flush();
        // Only 3 in flight at a time (concurrency = 3).
        expect(pending.length).toBe(3);
        expect(calls.map((c) => c.start)).toEqual([0, 100, 200]);
    });

    it("priority request fetches just the intersecting chunks ahead of pump", async () => {
        const store = makeStore(1000);
        const { fetcher, calls, pending, resolveFirst } = makeControlledFetcher();
        const loader = createChunkLoader(store, {
            path: "/x",
            totalSize: 1000,
            chunkBytes: 100,
            concurrency: 1,
            fetcher,
            onChunk: (start, blob) => store.add(start, blob),
        });

        await flush();
        // Pump enqueued idx 0 first.
        expect(calls.map((c) => c.start)).toEqual([0]);

        // Request a tail range — should slip to the front of the queue.
        loader.request(900, 1000);

        // Resolve the in-flight one — now the loader should pick the priority.
        resolveFirst(bytesFor);
        await flush();
        expect(calls.map((c) => c.start)).toEqual([0, 900]);

        // Resolve the priority one; pump continues from where it left off (idx 1 → 100).
        resolveFirst(bytesFor);
        await flush();
        expect(calls.map((c) => c.start)).toEqual([0, 900, 100]);
        // Cleanup
        pending.forEach((p) => p.resolve(bytesFor(p.start, p.length)));
    });

    it("dedupes: request for in-flight chunk does not double-fetch", async () => {
        const store = makeStore(300);
        const { fetcher, calls, pending } = makeControlledFetcher();
        const loader = createChunkLoader(store, {
            path: "/x",
            totalSize: 300,
            chunkBytes: 100,
            concurrency: 3,
            fetcher,
            onChunk: (start, blob) => store.add(start, blob),
        });

        await flush();
        expect(calls.length).toBe(3);

        // Re-request the same ranges (all in-flight already).
        loader.request(0, 300);
        await flush();
        expect(calls.length).toBe(3);
        pending.forEach((p) => p.resolve(bytesFor(p.start, p.length)));
    });

    it("cancel stops further enqueues", async () => {
        const store = makeStore(1000);
        const { fetcher, calls, pending, resolveFirst } = makeControlledFetcher();
        const loader = createChunkLoader(store, {
            path: "/x",
            totalSize: 1000,
            chunkBytes: 100,
            concurrency: 1,
            fetcher,
            onChunk: (start, blob) => store.add(start, blob),
        });

        await flush();
        expect(calls.length).toBe(1);
        loader.cancel();
        resolveFirst(bytesFor); // resolves the only in-flight
        await flush();
        // No new fetches after cancel.
        expect(calls.length).toBe(1);
        // store should NOT have received the chunk (cancel discards results).
        expect(store.isLoaded(0, 100)).toBe(false);
        pending.forEach((p) => p.resolve(bytesFor(p.start, p.length)));
    });

    it("onDone fires when all chunks loaded; no over-fetch", async () => {
        const store = makeStore(250);
        const { fetcher, calls, pending } = makeControlledFetcher();
        let done = false;
        createChunkLoader(store, {
            path: "/x",
            totalSize: 250,
            chunkBytes: 100,
            concurrency: 2,
            fetcher,
            onChunk: (start, blob) => store.add(start, blob),
            onDone: () => {
                done = true;
            },
        });

        // Resolve all chunks as they come in.
        // chunkRange: idx0 → [0,100), idx1 → [100,200), idx2 → [200,250) (length 50)
        for (let pass = 0; pass < 5; pass++) {
            await flush();
            while (pending.length > 0) {
                const p = pending.shift()!;
                p.resolve(bytesFor(p.start, p.length));
            }
        }
        await flush();
        expect(done).toBe(true);
        const total = calls.reduce((sum, c) => sum + c.length, 0);
        expect(total).toBe(250);
        // Three chunks total.
        expect(calls.length).toBe(3);
    });
});
