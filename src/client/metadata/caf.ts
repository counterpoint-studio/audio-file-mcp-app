import type { ParseResult, SampleFormat } from "./types";

const kCAFLinearPCMFormatFlagIsFloat = 0x1;
// const kCAFLinearPCMFormatFlagIsLittleEndian = 0x2;

function isAscii(bytes: Uint8Array, offset: number, str: string): boolean {
    if (offset + str.length > bytes.byteLength) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
    return (
        String.fromCharCode(bytes[offset]) +
        String.fromCharCode(bytes[offset + 1]) +
        String.fromCharCode(bytes[offset + 2]) +
        String.fromCharCode(bytes[offset + 3])
    );
}

function readUint64BE(dv: DataView, offset: number): number {
    const hi = dv.getUint32(offset, false);
    const lo = dv.getUint32(offset + 4, false);
    return hi * 4294967296 + lo;
}

function channelLayoutFor(channels: number): string {
    if (channels === 1) return "mono";
    if (channels === 2) return "stereo";
    return `${channels}-channel`;
}

function codecFor(
    formatId: string,
    formatFlags: number,
): { sampleFormat: SampleFormat; codec?: string } {
    switch (formatId) {
        case "lpcm":
            return {
                sampleFormat:
                    (formatFlags & kCAFLinearPCMFormatFlagIsFloat) !== 0
                        ? "pcm-float"
                        : "pcm-int",
            };
        case "alaw":
            return { sampleFormat: "alaw" };
        case "ulaw":
            return { sampleFormat: "mulaw" };
        case "ima4":
            return { sampleFormat: "ima4", codec: "IMA4" };
        case "aac ":
            return { sampleFormat: "compressed", codec: "AAC" };
        case "alac":
            return { sampleFormat: "compressed", codec: "Apple Lossless" };
        default:
            return { sampleFormat: "compressed", codec: formatId.trim() };
    }
}

export function parseCaf(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 8) return null;
    if (!isAscii(bytes, 0, "caff")) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let result: NonNullable<ParseResult> | null = null;
    let sampleRate = 0;
    let bytesPerPacket = 0;
    let framesPerPacket = 0;
    let dataChunkSize = 0;
    let paktValidFrames = 0;
    let offset = 8;
    while (offset + 12 <= bytes.byteLength) {
        const chunkType = readFourCC(bytes, offset);
        const chunkSize = readUint64BE(dv, offset + 4);
        const payload = offset + 12;
        if (chunkType === "desc") {
            if (payload + 32 > bytes.byteLength) return null;
            sampleRate = dv.getFloat64(payload, false);
            const formatId = readFourCC(bytes, payload + 8);
            const formatFlags = dv.getUint32(payload + 12, false);
            bytesPerPacket = dv.getUint32(payload + 16, false);
            framesPerPacket = dv.getUint32(payload + 20, false);
            const channels = dv.getUint32(payload + 24, false);
            const bitsPerChannel = dv.getUint32(payload + 28, false);
            const mapped = codecFor(formatId, formatFlags);
            result = {
                channels,
                channelLayout: channelLayoutFor(channels),
                sampleRate: Math.round(sampleRate),
                sampleFormat: mapped.sampleFormat,
            };
            if (
                (mapped.sampleFormat === "pcm-int" ||
                    mapped.sampleFormat === "pcm-float") &&
                bitsPerChannel > 0
            ) {
                result.bitDepth = bitsPerChannel;
            }
            if (mapped.codec) result.codec = mapped.codec;
        } else if (chunkType === "pakt") {
            if (payload + 24 <= bytes.byteLength) {
                paktValidFrames = readUint64BE(dv, payload + 8);
            }
        } else if (chunkType === "data") {
            dataChunkSize = chunkSize;
        }
        offset = payload + chunkSize;
        if (!Number.isFinite(offset)) return null;
    }
    if (result && sampleRate > 0) {
        let numFrames = 0;
        if (paktValidFrames > 0) {
            numFrames = paktValidFrames;
        } else if (
            framesPerPacket > 0 &&
            bytesPerPacket > 0 &&
            dataChunkSize > 4
        ) {
            // data chunk starts with a u32 edit count, then packets.
            numFrames =
                ((dataChunkSize - 4) / bytesPerPacket) * framesPerPacket;
        }
        if (numFrames > 0) {
            result.duration = numFrames / sampleRate;
            result.durationExact = true;
        }
    }
    return result;
}
