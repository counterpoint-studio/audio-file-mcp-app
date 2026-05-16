import { StreamSource, type StreamSourceOptions } from "mediabunny";
import type { ChunkStore } from "./chunk-store";
import type { ChunkLoader } from "./chunk-loader";

export type ChunkedSourceDeps = {
    store: ChunkStore;
    loader: Pick<ChunkLoader, "request">;
    /** Subscribe to chunk-arrival events. The payload (if any) is ignored. */
    onChunk: (cb: () => void) => () => void;
};

export function createChunkedSourceOptions(
    deps: ChunkedSourceDeps,
): StreamSourceOptions {
    const { store, loader, onChunk } = deps;
    return {
        getSize: () => store.totalSize,
        read: async (start, end) => {
            const clampedEnd = Math.min(end, store.totalSize);
            if (clampedEnd <= start) return new Uint8Array(0);
            if (store.isLoaded(start, clampedEnd)) {
                return await store.read(start, clampedEnd);
            }
            loader.request(start, clampedEnd);
            await waitForCoverage(store, start, clampedEnd, onChunk);
            return await store.read(start, clampedEnd);
        },
        prefetchProfile: "network",
    };
}

export function createChunkedSource(deps: ChunkedSourceDeps): StreamSource {
    return new StreamSource(createChunkedSourceOptions(deps));
}

function waitForCoverage(
    store: ChunkStore,
    start: number,
    end: number,
    subscribe: (cb: () => void) => () => void,
): Promise<void> {
    return new Promise<void>((resolve) => {
        if (store.isLoaded(start, end)) {
            resolve();
            return;
        }
        const off = subscribe(() => {
            if (store.isLoaded(start, end)) {
                off();
                resolve();
            }
        });
    });
}
