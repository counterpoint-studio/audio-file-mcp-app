const CHUNK_BASE64 = 1 << 20;       // 1 MiB; multiple of 4 → no padding split
const YIELD_EVERY_CHUNKS = 16;      // ~16 MiB of base64 between yields

export async function base64ToBlob(
    base64: string,
    type: string,
    stillCurrent: () => boolean,
): Promise<Blob | null> {
    const parts: Blob[] = [];
    let chunkIdx = 0;
    for (let pos = 0; pos < base64.length; pos += CHUNK_BASE64) {
        if (!stillCurrent()) return null;
        const bytes = Uint8Array.fromBase64(base64.slice(pos, pos + CHUNK_BASE64));
        parts.push(new Blob([bytes]));
        if (++chunkIdx % YIELD_EVERY_CHUNKS === 0) {
            await new Promise<void>(r => setTimeout(r));
        }
    }
    return new Blob(parts, { type });
}
