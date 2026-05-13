import type { ParseResult } from "./types";

const SAMPLE_RATES = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
    16000, 12000, 11025, 8000, 7350,
];

const PROFILE_NAMES: Record<number, string> = {
    0: "AAC-Main",
    1: "AAC-LC",
    2: "AAC-SSR",
    3: "AAC-LTP",
};

function channelLayoutFor(channels: number): string {
    if (channels === 1) return "mono";
    if (channels === 2) return "stereo";
    if (channels === 6) return "5.1";
    if (channels === 8) return "7.1";
    return `${channels}-channel`;
}

function findId3v2Skip(bytes: Uint8Array): number {
    if (bytes.byteLength < 10) return 0;
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
    const flags = bytes[5];
    const size =
        (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    const footer = (flags & 0x10) !== 0 ? 10 : 0;
    return 10 + size + footer;
}

export function parseAac(bytes: Uint8Array): ParseResult {
    const start = findId3v2Skip(bytes);
    if (start + 7 > bytes.byteLength) return null;

    // ADTS sync: 0xFFF (12 bits set).
    if (bytes[start] !== 0xff) return null;
    if ((bytes[start + 1] & 0xf0) !== 0xf0) return null;

    // Bits across bytes [start+1, start+2, start+3]:
    //   B1: sync(4) | id(1) | layer(2) | protection(1)
    //   B2: profile(2) | sampleFreqIndex(4) | private(1) | chanConfig high bit(1)
    //   B3: chanConfig low 2 bits(2) | originalCopy(1) | home(1) | copyrightIDBit(1) | copyrightIDStart(1) | frameLength high 2 bits(2)
    const b1 = bytes[start + 1];
    const b2 = bytes[start + 2];
    const b3 = bytes[start + 3];
    const layer = (b1 >> 1) & 0x03;
    if (layer !== 0) return null;
    const profile = (b2 >> 6) & 0x03;
    const srIdx = (b2 >> 2) & 0x0f;
    if (srIdx >= SAMPLE_RATES.length) return null;
    const chanCfg = ((b2 & 0x01) << 2) | ((b3 >> 6) & 0x03);
    if (chanCfg === 0) return null; // 0 = AOT-specified — we don't decode AudioSpecificConfig here.
    const channels = chanCfg === 7 ? 8 : chanCfg;

    // Walk ADTS frames: each header is 7 bytes (no CRC) or 9 bytes (with CRC,
    // bit 0 of b1 == 0). frame_length spans bits 30..43 of the header.
    let p = start;
    let frames = 0;
    while (p + 7 <= bytes.byteLength) {
        if (bytes[p] !== 0xff || (bytes[p + 1] & 0xf0) !== 0xf0) break;
        const frameLen =
            ((bytes[p + 3] & 0x03) << 11) |
            (bytes[p + 4] << 3) |
            (bytes[p + 5] >> 5);
        if (frameLen < 7) break;
        frames++;
        p += frameLen;
    }

    const result: NonNullable<ParseResult> = {
        channels,
        channelLayout: channelLayoutFor(channels),
        sampleRate: SAMPLE_RATES[srIdx],
        codec: PROFILE_NAMES[profile] ?? `AAC-Profile${profile}`,
        sampleFormat: "compressed",
    };
    if (frames > 0) {
        result.duration = (frames * 1024) / SAMPLE_RATES[srIdx];
        result.durationExact = true;
    }
    return result;
}
