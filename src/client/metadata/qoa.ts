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

export function parseQoa(bytes: Uint8Array): ParseResult {
    // File header: "qoaf" (4) + u32 samples (BE).
    // First frame header: u8 channels | u24 sampleRate | u16 fsamples | u16 framesize  (BE)
    if (bytes.byteLength < 16) return null;
    if (!isAscii(bytes, 0, "qoaf")) return null;
    const totalSamples =
        bytes[4] * 0x1000000 + (bytes[5] << 16) + (bytes[6] << 8) + bytes[7];
    const channels = bytes[8];
    const sampleRate = (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
    if (channels === 0 || sampleRate === 0) return null;
    const result: NonNullable<ParseResult> = {
        channels,
        channelLayout: channelLayoutFor(channels),
        sampleRate,
        codec: "QOA",
        sampleFormat: "compressed",
    };
    if (totalSamples > 0 && sampleRate > 0) {
        result.duration = totalSamples / sampleRate;
        result.durationExact = true;
    }
    return result;
}
