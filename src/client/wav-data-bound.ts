// `@audio/decode-wav` does not respect the `data` chunk's declared size: it
// treats everything from `dataStart` to EOF as PCM. WAVs in the wild often
// carry trailing metadata chunks (bext, iXML, LIST, smpl, SMED, …) after the
// audio, and those bytes get decoded as garbage samples — visible as a hot
// block at the end of the waveform/spectrogram.
//
// Bound the blob to `[0, dataStart + dataSize]` before handing it to the
// decoder so the trailing chunks never reach it.

const HEAD_SCAN_BYTES = 1 << 20; // 1 MiB — enough for fmt + bext + iXML + LIST in any plausible WAV.

export type WavDataBounds = { dataStart: number; dataSize: number };

export function findWavDataBounds(head: Uint8Array): WavDataBounds | null {
    if (head.byteLength < 12) return null;
    if (
        head[0] !== 0x52 || // R
        head[1] !== 0x49 || // I
        head[2] !== 0x46 || // F
        head[3] !== 0x46 // F
    ) {
        return null;
    }
    if (
        head[8] !== 0x57 || // W
        head[9] !== 0x41 || // A
        head[10] !== 0x56 || // V
        head[11] !== 0x45 // E
    ) {
        return null;
    }
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let offset = 12;
    while (offset + 8 <= head.byteLength) {
        const id =
            String.fromCharCode(head[offset]) +
            String.fromCharCode(head[offset + 1]) +
            String.fromCharCode(head[offset + 2]) +
            String.fromCharCode(head[offset + 3]);
        const size = dv.getUint32(offset + 4, true);
        if (id === "data") {
            return { dataStart: offset + 8, dataSize: size };
        }
        // RIFF chunks are word-aligned.
        offset += 8 + size + (size & 1);
    }
    return null;
}

export async function boundWavBlob(blob: Blob): Promise<Blob> {
    if (blob.size === 0) return blob;
    const headLen = Math.min(blob.size, HEAD_SCAN_BYTES);
    const head = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
    const bounds = findWavDataBounds(head);
    if (!bounds) return blob;
    const end = bounds.dataStart + bounds.dataSize;
    if (end <= 0 || end >= blob.size) return blob;
    return blob.slice(0, end);
}
