import type { ParseResult } from "./types";

// EBML IDs (kept as their full byte sequences — the leading 1-bit is the
// length marker that we match literally rather than stripping).
const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_AUDIO = 0xe1;
const ID_SAMPLING_FREQUENCY = 0xb5;
const ID_CHANNELS = 0x9f;

type VInt = { value: number; size: number };

function readVInt(bytes: Uint8Array, offset: number, end: number): VInt | null {
    if (offset >= end) return null;
    const first = bytes[offset];
    if (first === 0) return null;
    let size = 1;
    let mask = 0x80;
    while ((first & mask) === 0) {
        size += 1;
        mask >>>= 1;
        if (size > 8) return null;
    }
    if (offset + size > end) return null;
    let value = first & (mask - 1);
    for (let i = 1; i < size; i++) {
        value = value * 256 + bytes[offset + i];
    }
    return { value, size };
}

// Element IDs in EBML keep their length marker bits; this matches the spec's
// "ID is encoded as a raw VINT including the leading 1-bit".
function readElementId(bytes: Uint8Array, offset: number, end: number): VInt | null {
    if (offset >= end) return null;
    const first = bytes[offset];
    if (first === 0) return null;
    let size = 1;
    let mask = 0x80;
    while ((first & mask) === 0) {
        size += 1;
        mask >>>= 1;
        if (size > 4) return null;
    }
    if (offset + size > end) return null;
    let value = 0;
    for (let i = 0; i < size; i++) {
        value = value * 256 + bytes[offset + i];
    }
    return { value, size };
}

function readUintBE(bytes: Uint8Array, offset: number, len: number): number {
    let v = 0;
    for (let i = 0; i < len; i++) v = v * 256 + bytes[offset + i];
    return v;
}

function readFloatBE(
    dv: DataView,
    offset: number,
    len: number,
): number | undefined {
    if (len === 4) return dv.getFloat32(offset, false);
    if (len === 8) return dv.getFloat64(offset, false);
    return undefined;
}

function readUtf8(bytes: Uint8Array, offset: number, len: number): string {
    const slice = bytes.subarray(offset, offset + len);
    return new TextDecoder().decode(slice);
}

function channelLayoutFor(channels: number): string {
    if (channels === 1) return "mono";
    if (channels === 2) return "stereo";
    return `${channels}-channel`;
}

const CODEC_MAP: Record<string, string> = {
    A_OPUS: "Opus",
    A_VORBIS: "Vorbis",
    A_AAC: "AAC",
    A_FLAC: "FLAC",
    A_PCM_INT_LIT: "PCM",
    A_PCM_INT_BIG: "PCM",
    A_PCM_FLOAT: "PCM",
};

type TrackAudio = {
    codec?: string;
    sampleRate?: number;
    channels?: number;
};

function parseAudio(bytes: Uint8Array, dv: DataView, start: number, end: number): TrackAudio {
    const audio: TrackAudio = {};
    let p = start;
    while (p < end) {
        const id = readElementId(bytes, p, end);
        if (!id) break;
        p += id.size;
        const sz = readVInt(bytes, p, end);
        if (!sz) break;
        p += sz.size;
        const ep = p + sz.value;
        if (id.value === ID_SAMPLING_FREQUENCY) {
            const f = readFloatBE(dv, p, sz.value);
            if (f !== undefined) audio.sampleRate = Math.round(f);
        } else if (id.value === ID_CHANNELS) {
            audio.channels = readUintBE(bytes, p, sz.value);
        }
        p = ep;
    }
    return audio;
}

function parseTrackEntry(
    bytes: Uint8Array,
    dv: DataView,
    start: number,
    end: number,
): NonNullable<ParseResult> | null {
    let trackType: number | undefined;
    let codecId: string | undefined;
    let audio: TrackAudio = {};
    let p = start;
    while (p < end) {
        const id = readElementId(bytes, p, end);
        if (!id) break;
        p += id.size;
        const sz = readVInt(bytes, p, end);
        if (!sz) break;
        p += sz.size;
        const ep = p + sz.value;
        if (id.value === ID_TRACK_TYPE) {
            trackType = readUintBE(bytes, p, sz.value);
        } else if (id.value === ID_CODEC_ID) {
            codecId = readUtf8(bytes, p, sz.value);
        } else if (id.value === ID_AUDIO) {
            audio = parseAudio(bytes, dv, p, ep);
        }
        p = ep;
    }
    if (trackType !== 2) return null; // 2 = audio
    if (audio.channels === undefined || audio.sampleRate === undefined) return null;
    return {
        channels: audio.channels,
        channelLayout: channelLayoutFor(audio.channels),
        sampleRate: audio.sampleRate,
        codec: codecId ? (CODEC_MAP[codecId] ?? codecId) : undefined,
        sampleFormat: "compressed",
    };
}

function findChild(
    bytes: Uint8Array,
    start: number,
    end: number,
    targetId: number,
): { start: number; end: number } | null {
    let p = start;
    while (p < end) {
        const id = readElementId(bytes, p, end);
        if (!id) return null;
        p += id.size;
        const sz = readVInt(bytes, p, end);
        if (!sz) return null;
        p += sz.size;
        const ep = p + sz.value;
        if (id.value === targetId) return { start: p, end: ep };
        p = ep;
    }
    return null;
}

export function parseWebm(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 8) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ebml = readElementId(bytes, 0, bytes.byteLength);
    if (!ebml || ebml.value !== ID_EBML) return null;

    // Skip the EBML header and find the Segment element.
    let p = 0;
    while (p < bytes.byteLength) {
        const id = readElementId(bytes, p, bytes.byteLength);
        if (!id) return null;
        p += id.size;
        const sz = readVInt(bytes, p, bytes.byteLength);
        if (!sz) return null;
        p += sz.size;
        const ep = p + sz.value;
        if (id.value === ID_SEGMENT) {
            const tracks = findChild(bytes, p, Math.min(ep, bytes.byteLength), ID_TRACKS);
            if (!tracks) return null;
            // Iterate TrackEntry children. Return the first audio entry found.
            let q = tracks.start;
            while (q < tracks.end) {
                const eid = readElementId(bytes, q, tracks.end);
                if (!eid) break;
                q += eid.size;
                const esz = readVInt(bytes, q, tracks.end);
                if (!esz) break;
                q += esz.size;
                const eend = q + esz.value;
                if (eid.value === ID_TRACK_ENTRY) {
                    const entry = parseTrackEntry(bytes, dv, q, eend);
                    if (entry) return entry;
                }
                q = eend;
            }
            return null;
        }
        p = ep;
    }
    return null;
}
