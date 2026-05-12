import type { ParseResult } from "./types";

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

type AtomCallback = (
    type: string,
    payloadStart: number,
    payloadEnd: number,
) => boolean | void;

// Walks all atoms in [start, end). Calls cb for each; cb may return `true` to
// stop. Handles 32-bit size, size=1 (64-bit extended), and size=0 (extends to end).
function walkAtoms(
    bytes: Uint8Array,
    dv: DataView,
    start: number,
    end: number,
    cb: AtomCallback,
): boolean {
    let offset = start;
    while (offset + 8 <= end) {
        const size32 = dv.getUint32(offset, false);
        const type = readFourCC(bytes, offset + 4);
        let headerSize = 8;
        let totalSize: number;
        if (size32 === 1) {
            if (offset + 16 > end) break;
            totalSize = readUint64BE(dv, offset + 8);
            headerSize = 16;
        } else if (size32 === 0) {
            totalSize = end - offset;
        } else {
            totalSize = size32;
        }
        if (totalSize < headerSize) break;
        const payloadStart = offset + headerSize;
        const payloadEnd = Math.min(offset + totalSize, end);
        const stop = cb(type, payloadStart, payloadEnd);
        if (stop === true) return true;
        offset += totalSize;
    }
    return false;
}

function descendInto(
    types: readonly string[],
): (bytes: Uint8Array, dv: DataView, start: number, end: number, onLeaf: AtomCallback) => boolean {
    return function descend(bytes, dv, start, end, onLeaf): boolean {
        const target = types[0];
        const rest = types.slice(1);
        let found = false;
        walkAtoms(bytes, dv, start, end, (type, ps, pe) => {
            if (type !== target) return;
            if (rest.length === 0) {
                if (onLeaf(type, ps, pe) === true) {
                    found = true;
                    return true;
                }
            } else {
                if (descendInto(rest)(bytes, dv, ps, pe, onLeaf)) {
                    found = true;
                    return true;
                }
            }
        });
        return found;
    };
}

function parseEsdsAvgBitrate(
    bytes: Uint8Array,
    dv: DataView,
    start: number,
    end: number,
): number | undefined {
    // esds payload: 4-byte version+flags, then ES_Descriptor.
    // The descriptor tree uses (tag, size) where size is variable-length (7 bits/byte).
    // ES tag = 0x03, DecoderConfigDescriptor tag = 0x04.
    // Inside DecoderConfigDescriptor: u8 OTI + u8 streamType/up/reserved + u24 buffer + u32 maxBitrate + u32 avgBitrate.
    let p = start + 4;
    function readDescLen(): number {
        let n = 0;
        for (let i = 0; i < 4 && p < end; i++) {
            const b = bytes[p++];
            n = (n << 7) | (b & 0x7f);
            if ((b & 0x80) === 0) break;
        }
        return n;
    }
    while (p < end) {
        const tag = bytes[p++];
        const len = readDescLen();
        const dEnd = p + len;
        if (tag === 0x03) {
            // ES_Descriptor: u16 ES_ID, u8 flags. Possibly followed by depends/url/ocr fields.
            const flags = bytes[p + 2];
            let dp = p + 3;
            if (flags & 0x80) dp += 2; // dependsOn_ES_ID
            if (flags & 0x40) {
                const urlLen = bytes[dp];
                dp += 1 + urlLen;
            }
            if (flags & 0x20) dp += 2; // OCR_ES_ID
            // Now expect DecoderConfigDescriptor.
            p = dp;
            continue;
        }
        if (tag === 0x04) {
            // DecoderConfigDescriptor.
            if (p + 13 > end) return undefined;
            const maxBitrate = dv.getUint32(p + 5, false);
            const avgBitrate = dv.getUint32(p + 9, false);
            return avgBitrate > 0 ? avgBitrate : maxBitrate > 0 ? maxBitrate : undefined;
        }
        p = dEnd;
    }
    return undefined;
}

export function parseM4a(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 12) return null;
    // Quick sanity: an MP4/M4A starts with an `ftyp` atom.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const firstType = readFourCC(bytes, 4);
    if (firstType !== "ftyp") return null;

    let result: NonNullable<ParseResult> | null = null;

    // Path: moov > trak > mdia > minf > stbl > stsd > (mp4a|whatever)
    descendInto(["moov", "trak", "mdia", "minf", "stbl", "stsd"])(
        bytes,
        dv,
        0,
        bytes.byteLength,
        (_type, ps, pe) => {
            // stsd payload: u8 version + u24 flags + u32 entry_count, then entries.
            if (ps + 8 > pe) return;
            let p = ps + 8;
            while (p + 8 <= pe) {
                const size = dv.getUint32(p, false);
                const fmt = readFourCC(bytes, p + 4);
                const entryEnd = p + size;
                if (fmt === "mp4a") {
                    // SampleEntry layout (8 reserved + dataRefIndex u16) then AudioSampleEntry:
                    //   u32+u32 reserved (8 bytes), u16 channels, u16 sampleSize, u16 predefined,
                    //   u16 reserved, u32 sampleRate (fixed 16.16).
                    if (p + 8 + 8 + 8 + 8 > pe) return;
                    const base = p + 8 + 8 + 8; // skip SampleEntry head + 8 bytes reserved
                    const channels = dv.getUint16(base, false);
                    const sampleSize = dv.getUint16(base + 2, false);
                    void sampleSize;
                    const sampleRateFixed = dv.getUint32(base + 8, false);
                    const sampleRate = (sampleRateFixed >>> 16) & 0xffff;
                    result = {
                        channels,
                        channelLayout: channelLayoutFor(channels),
                        sampleRate,
                        codec: "AAC-LC",
                        sampleFormat: "compressed",
                    };
                    // Walk child atoms for `esds`.
                    walkAtoms(bytes, dv, base + 12, entryEnd, (childType, cps, cpe) => {
                        if (childType === "esds") {
                            const bps = parseEsdsAvgBitrate(bytes, dv, cps, cpe);
                            if (bps !== undefined && result) {
                                result.bitrate = bps;
                                result.bitrateExact = true;
                            }
                            return true;
                        }
                    });
                    return true;
                }
                p += size;
                if (size === 0) break;
            }
        },
    );

    return result;
}
