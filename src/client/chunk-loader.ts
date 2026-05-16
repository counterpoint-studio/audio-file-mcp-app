import type { ChunkStore } from "./chunk-store";

export type ChunkLoaderOptions = {
    path: string;
    totalSize: number;
    chunkBytes?: number;
    concurrency?: number;
    fetcher: (start: number, length: number) => Promise<Uint8Array>;
    onChunk?: (start: number, blob: Blob) => void;
    onError?: (e: unknown) => void;
    onDone?: () => void;
};

export type ChunkLoader = {
    request(start: number, end: number): void;
    cancel(): void;
    readonly cancelled: boolean;
};

const DEFAULT_CHUNK_BYTES = 1 << 20;
const DEFAULT_CONCURRENCY = 4;

export function createChunkLoader(
    store: ChunkStore,
    opts: ChunkLoaderOptions,
): ChunkLoader {
    const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    const totalSize = opts.totalSize;
    const totalChunks =
        totalSize === 0 ? 0 : Math.ceil(totalSize / chunkBytes);

    let cancelled = false;
    let nextSequential = 0; // next chunk index to enqueue from sequential pump
    let inFlight = 0;
    let loadedCount = 0;
    let doneEmitted = false;

    // Pending priority queue (chunk indexes ahead of nextSequential).
    const priority: number[] = [];
    const inFlightSet = new Set<number>();
    const loadedSet = new Set<number>();

    function chunkRange(idx: number): [number, number] {
        const start = idx * chunkBytes;
        const end = Math.min(start + chunkBytes, totalSize);
        return [start, end];
    }

    function maybeEmitDone(): void {
        if (
            !doneEmitted &&
            !cancelled &&
            loadedCount >= totalChunks &&
            inFlight === 0
        ) {
            doneEmitted = true;
            opts.onDone?.();
        }
    }

    function pickNext(): number | null {
        if (cancelled) return null;
        while (priority.length > 0) {
            const idx = priority.shift()!;
            if (loadedSet.has(idx) || inFlightSet.has(idx)) continue;
            return idx;
        }
        while (nextSequential < totalChunks) {
            const idx = nextSequential++;
            if (loadedSet.has(idx) || inFlightSet.has(idx)) continue;
            return idx;
        }
        return null;
    }

    function pump(): void {
        if (cancelled) return;
        while (inFlight < concurrency) {
            const idx = pickNext();
            if (idx === null) {
                maybeEmitDone();
                return;
            }
            launch(idx);
        }
    }

    function launch(idx: number): void {
        inFlightSet.add(idx);
        inFlight++;
        const [start, end] = chunkRange(idx);
        const length = end - start;
        Promise.resolve()
            .then(() => opts.fetcher(start, length))
            .then(
                (bytes) => {
                    if (cancelled) return;
                    if (bytes.length !== length) {
                        throw new Error(
                            `chunk ${idx}: expected ${length} bytes, got ${bytes.length}`,
                        );
                    }
                    const blob = new Blob([bytes as BlobPart]);
                    loadedSet.add(idx);
                    loadedCount++;
                    if (opts.onChunk) opts.onChunk(start, blob);
                },
                (err) => {
                    if (cancelled) return;
                    opts.onError?.(err);
                },
            )
            .finally(() => {
                inFlightSet.delete(idx);
                inFlight--;
                if (!cancelled) pump();
                else maybeEmitDone();
            });
    }

    // Kick off sequential pump asynchronously so caller can wire onChunk first.
    queueMicrotask(pump);

    return {
        request(start: number, end: number): void {
            if (cancelled) return;
            const s = Math.max(0, Math.min(totalSize, start));
            const e = Math.max(s, Math.min(totalSize, end));
            if (e <= s) return;
            const firstIdx = Math.floor(s / chunkBytes);
            const lastIdx = Math.floor((e - 1) / chunkBytes);
            for (let idx = firstIdx; idx <= lastIdx; idx++) {
                if (loadedSet.has(idx) || inFlightSet.has(idx)) continue;
                if (priority.includes(idx)) continue;
                priority.push(idx);
            }
            pump();
        },
        cancel(): void {
            if (cancelled) return;
            cancelled = true;
            priority.length = 0;
        },
        get cancelled() {
            return cancelled;
        },
    };
}
