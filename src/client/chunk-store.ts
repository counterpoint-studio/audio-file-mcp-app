export type ChunkStore = {
    readonly totalSize: number;
    add(start: number, blob: Blob): void;
    isLoaded(start: number, end: number): boolean;
    read(start: number, end: number): Promise<Uint8Array>;
    gaps(start: number, end: number): Array<[number, number]>;
};

type Entry = { start: number; end: number; blob: Blob };

export function createChunkStore(totalSize: number): ChunkStore {
    if (!Number.isInteger(totalSize) || totalSize < 0) {
        throw new Error("totalSize must be a non-negative integer");
    }
    const entries: Entry[] = [];

    function findIndex(start: number): number {
        // Binary search for the first entry whose start >= `start`.
        let lo = 0,
            hi = entries.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (entries[mid].start < start) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    function clamp(start: number, end: number): [number, number] {
        const s = Math.max(0, Math.min(totalSize, start));
        const e = Math.max(s, Math.min(totalSize, end));
        return [s, e];
    }

    return {
        get totalSize() {
            return totalSize;
        },

        add(start: number, blob: Blob): void {
            if (!Number.isInteger(start) || start < 0) {
                throw new Error("start must be a non-negative integer");
            }
            const end = start + blob.size;
            if (end > totalSize) {
                throw new Error(
                    `chunk end ${end} exceeds totalSize ${totalSize}`,
                );
            }
            const idx = findIndex(start);
            const prev = idx > 0 ? entries[idx - 1] : null;
            const next = idx < entries.length ? entries[idx] : null;
            if (prev && prev.end > start) {
                throw new Error(
                    `chunk at ${start} overlaps existing chunk ending at ${prev.end}`,
                );
            }
            if (next && next.start < end) {
                throw new Error(
                    `chunk [${start}, ${end}) overlaps existing chunk starting at ${next.start}`,
                );
            }
            entries.splice(idx, 0, { start, end, blob });
        },

        isLoaded(start: number, end: number): boolean {
            const [s, e] = clamp(start, end);
            if (e <= s) return true;
            let cursor = s;
            let i = findIndex(cursor);
            if (i > 0 && entries[i - 1].end > cursor) i = i - 1;
            while (cursor < e) {
                const entry = entries[i];
                if (!entry || entry.start > cursor) return false;
                cursor = entry.end;
                i++;
            }
            return cursor >= e;
        },

        async read(start: number, end: number): Promise<Uint8Array> {
            const [s, e] = clamp(start, end);
            const length = e - s;
            const out = new Uint8Array(length);
            if (length === 0) return out;
            let cursor = s;
            let i = findIndex(cursor);
            if (i > 0 && entries[i - 1].end > cursor) i = i - 1;
            while (cursor < e) {
                const entry = entries[i];
                if (!entry || entry.start > cursor || entry.end <= cursor) {
                    throw new Error(
                        `range [${s}, ${e}) not fully covered (gap at ${cursor})`,
                    );
                }
                const sliceStart = cursor - entry.start;
                const sliceEnd = Math.min(entry.end, e) - entry.start;
                const slice = entry.blob.slice(sliceStart, sliceEnd);
                const buf = new Uint8Array(await slice.arrayBuffer());
                out.set(buf, cursor - s);
                cursor += buf.length;
                i++;
            }
            return out;
        },

        gaps(start: number, end: number): Array<[number, number]> {
            const [s, e] = clamp(start, end);
            const result: Array<[number, number]> = [];
            if (e <= s) return result;
            let cursor = s;
            let i = findIndex(cursor);
            if (i > 0 && entries[i - 1].end > cursor) i = i - 1;
            while (cursor < e) {
                const entry = entries[i];
                if (!entry || entry.start >= e) {
                    result.push([cursor, e]);
                    return result;
                }
                if (entry.start > cursor) {
                    result.push([cursor, entry.start]);
                }
                cursor = Math.max(cursor, entry.end);
                i++;
            }
            return result;
        },
    };
}
