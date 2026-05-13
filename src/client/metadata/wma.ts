import type { ParseResult } from "./types";

// ASF GUIDs stored as little-endian raw bytes.
const ASF_HEADER_GUID = Uint8Array.from([
    0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
    0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
]);
const STREAM_PROPERTIES_GUID = Uint8Array.from([
    0x91, 0x07, 0xdc, 0xb7, 0xb7, 0xa9, 0xcf, 0x11,
    0x8e, 0xe6, 0x00, 0xc0, 0x0c, 0x20, 0x53, 0x65,
]);
const FILE_PROPERTIES_GUID = Uint8Array.from([
    0xa1, 0xdc, 0xab, 0x8c, 0x47, 0xa9, 0xcf, 0x11,
    0x8e, 0xe4, 0x00, 0xc0, 0x0c, 0x20, 0x53, 0x65,
]);
const AUDIO_MEDIA_GUID = Uint8Array.from([
    0x40, 0x9e, 0x69, 0xf8, 0x4d, 0x5b, 0xcf, 0x11,
    0xa8, 0xfd, 0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b,
]);

const CODEC_NAME_BY_TAG: Record<number, string> = {
    0x0160: "Windows Media Audio 1",
    0x0161: "Windows Media Audio 2",
    0x0162: "Windows Media Audio Pro",
    0x0163: "Windows Media Audio Lossless",
    0x000a: "Windows Media Audio Voice",
};

function guidEquals(bytes: Uint8Array, offset: number, guid: Uint8Array): boolean {
    if (offset + 16 > bytes.byteLength) return false;
    for (let i = 0; i < 16; i++) {
        if (bytes[offset + i] !== guid[i]) return false;
    }
    return true;
}

function readUint64LE(dv: DataView, offset: number): number {
    const lo = dv.getUint32(offset, true);
    const hi = dv.getUint32(offset + 4, true);
    return hi * 4294967296 + lo;
}

function channelLayoutFor(channels: number): string {
    if (channels === 1) return "mono";
    if (channels === 2) return "stereo";
    return `${channels}-channel`;
}

export function parseWma(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 30) return null;
    if (!guidEquals(bytes, 0, ASF_HEADER_GUID)) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const totalSize = readUint64LE(dv, 16);
    if (totalSize < 30 || totalSize > bytes.byteLength) {
        // size is informational; clamp instead of failing.
    }
    const headerEnd = Math.min(bytes.byteLength, Math.max(30, totalSize));
    let result: NonNullable<ParseResult> | null = null;
    let playDuration100ns = 0;
    let prerollMs = 0;
    // Sub-objects begin at offset 30 (after numHeaderObjs + 2 reserved bytes).
    let p = 30;
    while (p + 24 <= headerEnd) {
        const objSize = readUint64LE(dv, p + 16);
        if (objSize < 24 || p + objSize > headerEnd + 64) break; // guard
        if (guidEquals(bytes, p, FILE_PROPERTIES_GUID)) {
            // Payload offset 40: Play Duration (u64 LE, 100 ns units).
            // Payload offset 56: Preroll (u64 LE, ms) — Play Duration includes this.
            const sp = p + 24;
            if (sp + 64 <= headerEnd) {
                playDuration100ns = readUint64LE(dv, sp + 40);
                prerollMs = readUint64LE(dv, sp + 56);
            }
        } else if (guidEquals(bytes, p, STREAM_PROPERTIES_GUID)) {
            // Stream Properties Object payload starts at p+24.
            const sp = p + 24;
            // StreamType GUID (16) + ErrorCorrectionType GUID (16) + TimeOffset(8)
            // + TypeSpecificDataLength(4) + ErrorCorrectionDataLength(4) + Flags(2)
            // + Reserved(4) = 54 bytes before TypeSpecificData.
            if (sp + 54 > headerEnd) {
                p += objSize;
                continue;
            }
            if (!guidEquals(bytes, sp, AUDIO_MEDIA_GUID)) {
                p += objSize;
                continue;
            }
            const tsd = sp + 54;
            // WAVEFORMATEX inside type-specific data:
            //   u16 wFormatTag | u16 channels | u32 sampleRate |
            //   u32 avgBytesPerSec | u16 blockAlign | u16 bitsPerSample | ...
            if (tsd + 16 > bytes.byteLength) return null;
            const formatTag = dv.getUint16(tsd, true);
            const channels = dv.getUint16(tsd + 2, true);
            const sampleRate = dv.getUint32(tsd + 4, true);
            const avgBytesPerSec = dv.getUint32(tsd + 8, true);
            result = {
                channels,
                channelLayout: channelLayoutFor(channels),
                sampleRate,
                codec:
                    CODEC_NAME_BY_TAG[formatTag] ??
                    `Unknown WMA codec (0x${formatTag.toString(16).padStart(4, "0")})`,
                sampleFormat: "compressed",
                bitrate: avgBytesPerSec > 0 ? avgBytesPerSec * 8 : undefined,
                bitrateExact: avgBytesPerSec > 0 ? true : undefined,
            };
        }
        p += objSize;
    }
    if (result && playDuration100ns > 0) {
        const seconds = (playDuration100ns - prerollMs * 10000) / 1e7;
        if (seconds > 0) {
            result.duration = seconds;
            result.durationExact = true;
        }
    }
    return result;
}
