import type { ParseResult } from "./types";

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

export function parseFlac(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 4 + 4 + 34) return null;
    if (!isAscii(bytes, 0, "fLaC")) return null;
    // First metadata block follows the magic. Header is:
    //   1 byte: last-block flag (1 bit) | block type (7 bits)
    //   3 bytes: length (big-endian)
    // STREAMINFO is type 0 and must be the first metadata block.
    const blockType = bytes[4] & 0x7f;
    if (blockType !== 0) return null;
    const blockLen = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
    if (blockLen < 34) return null;
    if (8 + 34 > bytes.byteLength) return null;
    const p = 8;
    // Bytes 10..13 contain sampleRate(20) | channels-1(3) | bitDepth-1(5) | top 4 bits of samples(36)
    const b10 = bytes[p + 10];
    const b11 = bytes[p + 11];
    const b12 = bytes[p + 12];
    const b13 = bytes[p + 13];
    const sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
    const channels = ((b12 >> 1) & 0x07) + 1;
    const bitDepth = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
    const samplesTop4 = b13 & 0x0f;
    const b14 = bytes[p + 14];
    const b15 = bytes[p + 15];
    const b16 = bytes[p + 16];
    const b17 = bytes[p + 17];
    const samplesLow32 =
        b14 * 0x1000000 + (b15 << 16) + (b16 << 8) + b17;
    const totalSamples = samplesTop4 * 0x100000000 + samplesLow32;
    const result: NonNullable<ParseResult> = {
        channels,
        channelLayout: channelLayoutFor(channels),
        sampleRate,
        bitDepth,
        sampleFormat: "pcm-int",
    };
    if (totalSamples > 0 && sampleRate > 0) {
        result.duration = totalSamples / sampleRate;
        result.durationExact = true;
    }
    return result;
}
