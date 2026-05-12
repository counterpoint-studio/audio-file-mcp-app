import type { ParseResult, SampleFormat } from "./types";

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

// 80-bit IEEE 754 extended-precision float as used in AIFF COMM chunks
// for the sample-rate field. Big-endian: 2-byte sign+exponent, 8-byte mantissa.
function parseExtendedFloat80(bytes: Uint8Array, offset: number): number {
    const sign = (bytes[offset] & 0x80) >>> 7;
    const exponent = ((bytes[offset] & 0x7f) << 8) | bytes[offset + 1];
    let mantissaHi = 0;
    for (let i = 0; i < 4; i++) mantissaHi = mantissaHi * 256 + bytes[offset + 2 + i];
    let mantissaLo = 0;
    for (let i = 0; i < 4; i++) mantissaLo = mantissaLo * 256 + bytes[offset + 6 + i];
    if (exponent === 0 && mantissaHi === 0 && mantissaLo === 0) return 0;
    if (exponent === 0x7fff) return Infinity;
    // Combine into a single 64-bit mantissa (full integer-valued mantissa).
    const mantissa = mantissaHi * 4294967296 + mantissaLo;
    const value = mantissa * Math.pow(2, exponent - 16383 - 63);
    return sign ? -value : value;
}

type AifcInfo = { sampleFormat: SampleFormat; codec?: string };

const AIFC_COMPRESSION: Record<string, AifcInfo> = {
    NONE: { sampleFormat: "pcm-int" },
    twos: { sampleFormat: "pcm-int" },
    sowt: { sampleFormat: "pcm-int", codec: "PCM little-endian" },
    fl32: { sampleFormat: "pcm-float" },
    FL32: { sampleFormat: "pcm-float" },
    fl64: { sampleFormat: "pcm-float" },
    FL64: { sampleFormat: "pcm-float" },
    ulaw: { sampleFormat: "mulaw" },
    ULAW: { sampleFormat: "mulaw" },
    alaw: { sampleFormat: "alaw" },
    ALAW: { sampleFormat: "alaw" },
    ima4: { sampleFormat: "ima4" },
};

function channelLayoutFor(channels: number): string {
    if (channels === 1) return "mono";
    if (channels === 2) return "stereo";
    return `${channels}-channel`;
}

export function parseAiff(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 12) return null;
    if (!isAscii(bytes, 0, "FORM")) return null;
    const formType = readFourCC(bytes, 8);
    if (formType !== "AIFF" && formType !== "AIFC") return null;
    const isAifc = formType === "AIFC";

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    while (offset + 8 <= bytes.byteLength) {
        const chunkId = readFourCC(bytes, offset);
        const chunkSize = dv.getUint32(offset + 4, false);
        if (chunkId === "COMM") {
            if (offset + 8 + 18 > bytes.byteLength) return null;
            const p = offset + 8;
            const channels = dv.getInt16(p, false);
            const sampleSize = dv.getInt16(p + 6, false);
            const sampleRate = Math.round(parseExtendedFloat80(bytes, p + 8));

            const result: NonNullable<ParseResult> = {
                channels,
                channelLayout: channelLayoutFor(channels),
                sampleRate,
            };

            if (isAifc && chunkSize >= 22) {
                const compType = readFourCC(bytes, p + 18);
                const info = AIFC_COMPRESSION[compType];
                if (info) {
                    result.sampleFormat = info.sampleFormat;
                    if (info.codec) result.codec = info.codec;
                    if (
                        info.sampleFormat === "pcm-int" ||
                        info.sampleFormat === "pcm-float"
                    ) {
                        if (sampleSize > 0) result.bitDepth = sampleSize;
                    }
                } else {
                    result.sampleFormat = "compressed";
                    result.codec = compType;
                }
            } else {
                result.sampleFormat = "pcm-int";
                if (sampleSize > 0) result.bitDepth = sampleSize;
            }
            return result;
        }
        offset += 8 + chunkSize + (chunkSize & 1);
    }
    return null;
}
