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

// Ogg page header layout:
//   0..3   "OggS"
//   4      stream version
//   5      header type
//   6..13  granule position (i64)
//   14..17 stream serial number
//   18..21 page sequence number
//   22..25 CRC32
//   26     page_segments (u8)
//   27..   segment table (page_segments bytes)
// Page payload follows the segment table; total payload size = sum of segments.
function firstPagePayloadOffset(bytes: Uint8Array): number {
    if (bytes.byteLength < 27) return -1;
    if (!isAscii(bytes, 0, "OggS")) return -1;
    const pageSegments = bytes[26];
    if (27 + pageSegments > bytes.byteLength) return -1;
    return 27 + pageSegments;
}

export function parseOgg(bytes: Uint8Array): ParseResult {
    const payloadStart = firstPagePayloadOffset(bytes);
    if (payloadStart < 0) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Opus: first packet starts with 8-byte magic "OpusHead".
    if (isAscii(bytes, payloadStart, "OpusHead")) {
        // After "OpusHead":
        //   u8 version
        //   u8 channels
        //   u16 preSkip
        //   u32 inputSampleRate (LE)
        //   i16 outputGain
        //   u8 channelMappingFamily
        if (payloadStart + 8 + 11 > bytes.byteLength) return null;
        const p = payloadStart + 8;
        const channels = bytes[p + 1];
        const inputSampleRate = dv.getUint32(p + 4, true);
        const result: NonNullable<ParseResult> = {
            channels,
            channelLayout: channelLayoutFor(channels),
            sampleRate: 48000,
            codec: "Opus",
            sampleFormat: "compressed",
        };
        if (inputSampleRate > 0) result.inputSampleRate = inputSampleRate;
        return result;
    }

    // Vorbis identification packet: byte 0x01 + "vorbis".
    if (
        bytes[payloadStart] === 0x01 &&
        isAscii(bytes, payloadStart + 1, "vorbis")
    ) {
        // After "vorbis":
        //   u32 vorbis_version
        //   u8 audio_channels
        //   u32 audio_sample_rate (LE)
        //   u32 bitrate_maximum (LE)
        //   u32 bitrate_nominal (LE)
        //   u32 bitrate_minimum (LE)
        const p = payloadStart + 7;
        if (p + 4 + 1 + 4 + 4 + 4 + 4 > bytes.byteLength) return null;
        const channels = bytes[p + 4];
        const sampleRate = dv.getUint32(p + 5, true);
        const bitrateNominal = dv.getInt32(p + 13, true);
        const result: NonNullable<ParseResult> = {
            channels,
            channelLayout: channelLayoutFor(channels),
            sampleRate,
            codec: "Vorbis",
            sampleFormat: "compressed",
        };
        if (bitrateNominal > 0) {
            result.bitrate = bitrateNominal;
            result.bitrateExact = true;
        }
        return result;
    }

    return null;
}
