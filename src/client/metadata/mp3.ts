import type { ParseResult } from "./types";

// MPEG version (bits 19..20 of the 32-bit header).
const V25 = 0; // 00 = MPEG-2.5
const V_RESERVED = 1; // 01 = reserved
const V2 = 2; // 10 = MPEG-2
const V1 = 3; // 11 = MPEG-1

// Layer (bits 17..18). 01 = Layer III, 10 = II, 11 = I.

// Bitrate table: [version-group][layer][index]. Values in kbps; 0 = "free", -1 = invalid.
// version-group: 0 = MPEG-1, 1 = MPEG-2 or 2.5
// layer-group: 0 = Layer I, 1 = Layer II, 2 = Layer III
const BITRATE_KBPS: number[][][] = [
    [
        // MPEG-1
        [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, -1], // L1
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, -1], // L2
        [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1], // L3
    ],
    [
        // MPEG-2 / 2.5
        [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, -1], // L1
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1], // L2
        [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1], // L2/L3 share
    ],
];

const SAMPLE_RATE: Record<number, number[]> = {
    [V1]: [44100, 48000, 32000],
    [V2]: [22050, 24000, 16000],
    [V25]: [11025, 12000, 8000],
};

function skipId3v2(bytes: Uint8Array): number {
    if (bytes.byteLength < 10) return 0;
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
    const flags = bytes[5];
    const size =
        (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    const footer = (flags & 0x10) !== 0 ? 10 : 0;
    return 10 + size + footer;
}

function findFrameSync(bytes: Uint8Array, start: number): number {
    for (let i = start; i + 3 < bytes.byteLength; i++) {
        if (bytes[i] !== 0xff) continue;
        if ((bytes[i + 1] & 0xe0) !== 0xe0) continue;
        const version = (bytes[i + 1] >> 3) & 0x03;
        if (version === V_RESERVED) continue;
        const layer = (bytes[i + 1] >> 1) & 0x03;
        if (layer === 0) continue; // reserved
        const bitrateIdx = (bytes[i + 2] >> 4) & 0x0f;
        if (bitrateIdx === 0x0f) continue;
        const srIdx = (bytes[i + 2] >> 2) & 0x03;
        if (srIdx === 0x03) continue;
        return i;
    }
    return -1;
}

function layerLabel(layerBits: number): string {
    if (layerBits === 0b01) return "III";
    if (layerBits === 0b10) return "II";
    if (layerBits === 0b11) return "I";
    return "?";
}

function versionLabel(versionBits: number): string {
    if (versionBits === V1) return "1";
    if (versionBits === V2) return "2";
    if (versionBits === V25) return "2.5";
    return "?";
}

function samplesPerFrame(versionBits: number, layerBits: number): number {
    // Layer I: 384, Layer II: 1152, Layer III: 1152 (MPEG-1) or 576 (MPEG-2/2.5).
    if (layerBits === 0b11) return 384;
    if (layerBits === 0b10) return 1152;
    // Layer III
    return versionBits === V1 ? 1152 : 576;
}

function sideInfoLen(versionBits: number, channelMode: number): number {
    // MPEG-1: stereo/joint/dual = 32, mono = 17.
    // MPEG-2/2.5: stereo/joint/dual = 17, mono = 9.
    if (versionBits === V1) return channelMode === 3 ? 17 : 32;
    return channelMode === 3 ? 9 : 17;
}

function channelLayoutFor(mode: number): string {
    if (mode === 0) return "stereo";
    if (mode === 1) return "joint-stereo";
    if (mode === 2) return "dual-mono";
    return "mono";
}

function isAsciiAt(bytes: Uint8Array, offset: number, str: string): boolean {
    if (offset + str.length > bytes.byteLength) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] * 0x1000000) +
        (bytes[offset + 1] << 16) +
        (bytes[offset + 2] << 8) +
        bytes[offset + 3]
    );
}

export function parseMp3(bytes: Uint8Array): ParseResult {
    const skip = skipId3v2(bytes);
    const frameStart = findFrameSync(bytes, skip);
    if (frameStart < 0) return null;

    const h0 = bytes[frameStart];
    const h1 = bytes[frameStart + 1];
    const h2 = bytes[frameStart + 2];
    const h3 = bytes[frameStart + 3];
    void h0;
    const version = (h1 >> 3) & 0x03;
    const layer = (h1 >> 1) & 0x03;
    const bitrateIdx = (h2 >> 4) & 0x0f;
    const srIdx = (h2 >> 2) & 0x03;
    const channelMode = (h3 >> 6) & 0x03;

    const versionGroup = version === V1 ? 0 : 1;
    const layerGroup = layer === 0b11 ? 0 : layer === 0b10 ? 1 : 2;
    const headerBitrateKbps = BITRATE_KBPS[versionGroup][layerGroup][bitrateIdx];
    const sampleRate = SAMPLE_RATE[version][srIdx];
    if (sampleRate === undefined) return null;

    const channels = channelMode === 3 ? 1 : 2;
    const sideLen = sideInfoLen(version, channelMode);
    const tagOffset = frameStart + 4 + sideLen;

    let bitrate = headerBitrateKbps > 0 ? headerBitrateKbps * 1000 : undefined;
    let bitrateMode: "cbr" | "vbr" = "cbr";

    const isXing = isAsciiAt(bytes, tagOffset, "Xing");
    const isInfo = isAsciiAt(bytes, tagOffset, "Info");
    if (isXing || isInfo) {
        bitrateMode = isXing ? "vbr" : "cbr";
        if (isXing) {
            const flags = readUint32BE(bytes, tagOffset + 4);
            let p = tagOffset + 8;
            let totalFrames: number | undefined;
            let totalBytes: number | undefined;
            if (flags & 0x01) {
                totalFrames = readUint32BE(bytes, p);
                p += 4;
            }
            if (flags & 0x02) {
                totalBytes = readUint32BE(bytes, p);
                p += 4;
            }
            if (totalFrames !== undefined && totalBytes !== undefined && totalFrames > 0) {
                const spf = samplesPerFrame(version, layer);
                bitrate = Math.round((totalBytes * 8 * sampleRate) / (totalFrames * spf));
            }
        }
    } else if (isAsciiAt(bytes, frameStart + 4 + 32, "VBRI")) {
        // VBRI follows the frame header at fixed offset 36 (after 32 bytes of side info).
        bitrateMode = "vbr";
        const vbriOffset = frameStart + 4 + 32;
        // version(2) + delay(2) + quality(2) + bytes(4) + frames(4) + ...
        const totalBytes = readUint32BE(bytes, vbriOffset + 10);
        const totalFrames = readUint32BE(bytes, vbriOffset + 14);
        if (totalFrames > 0) {
            const spf = samplesPerFrame(version, layer);
            bitrate = Math.round((totalBytes * 8 * sampleRate) / (totalFrames * spf));
        }
    }

    const result: NonNullable<ParseResult> = {
        channels,
        channelLayout: channelLayoutFor(channelMode),
        sampleRate,
        codec: `MPEG-${versionLabel(version)} Layer ${layerLabel(layer)}`,
        sampleFormat: "compressed",
        bitrateMode,
    };
    if (bitrate !== undefined) {
        result.bitrate = bitrate;
        result.bitrateExact = true;
    }
    return result;
}
