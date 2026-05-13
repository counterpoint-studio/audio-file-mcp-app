import type { ParseResult, SampleFormat } from "./types";

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_ADPCM = 0x0002;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_ALAW = 0x0006;
const WAVE_FORMAT_MULAW = 0x0007;
const WAVE_FORMAT_DVI_ADPCM = 0x0011;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function isAscii(bytes: Uint8Array, offset: number, str: string): boolean {
    if (offset + str.length > bytes.byteLength) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
}

function channelLayoutFor(channels: number): string {
    if (channels === 1) return "mono";
    if (channels === 2) return "stereo";
    return `${channels}-channel`;
}

function formatToSample(tag: number): { sampleFormat: SampleFormat; codec?: string } {
    switch (tag) {
        case WAVE_FORMAT_PCM:
            return { sampleFormat: "pcm-int" };
        case WAVE_FORMAT_IEEE_FLOAT:
            return { sampleFormat: "pcm-float" };
        case WAVE_FORMAT_ALAW:
            return { sampleFormat: "alaw" };
        case WAVE_FORMAT_MULAW:
            return { sampleFormat: "mulaw" };
        case WAVE_FORMAT_ADPCM:
        case WAVE_FORMAT_DVI_ADPCM:
            return { sampleFormat: "adpcm" };
        default:
            return {
                sampleFormat: "compressed",
                codec: `Unknown (0x${tag.toString(16).padStart(4, "0")})`,
            };
    }
}

export function parseWav(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 12) return null;
    const isRiff = isAscii(bytes, 0, "RIFF");
    const isRifx = isAscii(bytes, 0, "RIFX");
    if (!isRiff && !isRifx) return null;
    if (!isAscii(bytes, 8, "WAVE")) return null;
    const littleEndian = isRiff;

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let result: NonNullable<ParseResult> | null = null;
    let avgBytesPerSec = 0;
    let dataChunkSize = 0;
    while (offset + 8 <= bytes.byteLength) {
        const chunkId =
            String.fromCharCode(bytes[offset]) +
            String.fromCharCode(bytes[offset + 1]) +
            String.fromCharCode(bytes[offset + 2]) +
            String.fromCharCode(bytes[offset + 3]);
        const chunkSize = dv.getUint32(offset + 4, littleEndian);
        if (chunkId === "fmt " && !result) {
            if (offset + 8 + 16 > bytes.byteLength) return null;
            const p = offset + 8;
            let formatTag = dv.getUint16(p, littleEndian);
            const channels = dv.getUint16(p + 2, littleEndian);
            const sampleRate = dv.getUint32(p + 4, littleEndian);
            avgBytesPerSec = dv.getUint32(p + 8, littleEndian);
            const bitsPerSample = dv.getUint16(p + 14, littleEndian);
            if (formatTag === WAVE_FORMAT_EXTENSIBLE && chunkSize >= 40) {
                // SubFormat GUID first 2 bytes carry the real format tag.
                const subFormatTag = dv.getUint16(p + 24, littleEndian);
                formatTag = subFormatTag;
            }
            const mapped = formatToSample(formatTag);
            result = {
                channels,
                channelLayout: channelLayoutFor(channels),
                sampleRate,
                sampleFormat: mapped.sampleFormat,
            };
            if (
                mapped.sampleFormat === "pcm-int" ||
                mapped.sampleFormat === "pcm-float"
            ) {
                if (bitsPerSample > 0) result.bitDepth = bitsPerSample;
            }
            if (mapped.codec) result.codec = mapped.codec;
        } else if (chunkId === "data") {
            dataChunkSize = chunkSize;
            break;
        }
        // Chunks are 2-byte aligned in RIFF.
        offset += 8 + chunkSize + (chunkSize & 1);
    }
    if (result && dataChunkSize > 0 && avgBytesPerSec > 0) {
        result.duration = dataChunkSize / avgBytesPerSec;
        result.durationExact = true;
    }
    return result;
}
