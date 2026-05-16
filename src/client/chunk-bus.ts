export type ChunkEvent = {
    start: number;
    end: number;
    blob: Blob;
};

export type ChunkBus = {
    subscribe(cb: (ev?: ChunkEvent) => void): () => void;
    emit(ev?: ChunkEvent): void;
};

export function createChunkBus(): ChunkBus {
    const subs = new Set<(ev?: ChunkEvent) => void>();
    return {
        subscribe(cb) {
            subs.add(cb);
            return () => {
                subs.delete(cb);
            };
        },
        emit(ev) {
            for (const cb of [...subs]) cb(ev);
        },
    };
}
