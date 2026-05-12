import type { ParseResult } from "./types";

const NB_MAGIC = "#!AMR\n";
const WB_MAGIC = "#!AMR-WB\n";

const NB_BITRATES_KBPS = [4.75, 5.15, 5.9, 6.7, 7.4, 7.95, 10.2, 12.2];
const WB_BITRATES_KBPS = [6.6, 8.85, 12.65, 14.25, 15.85, 18.25, 19.85, 23.05, 23.85];

function startsWith(bytes: Uint8Array, str: string): boolean {
    if (bytes.byteLength < str.length) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[i] !== str.charCodeAt(i)) return false;
    }
    return true;
}

export function parseAmr(bytes: Uint8Array): ParseResult {
    const isWb = startsWith(bytes, WB_MAGIC);
    const isNb = !isWb && startsWith(bytes, NB_MAGIC);
    if (!isNb && !isWb) return null;
    const magicLen = isWb ? WB_MAGIC.length : NB_MAGIC.length;
    if (bytes.byteLength < magicLen + 1) {
        return {
            channels: 1,
            channelLayout: "mono",
            sampleRate: isWb ? 16000 : 8000,
            codec: isWb ? "AMR-WB" : "AMR-NB",
            sampleFormat: "compressed",
        };
    }
    const toc = bytes[magicLen];
    const mode = (toc >> 3) & 0x0f;
    const table = isWb ? WB_BITRATES_KBPS : NB_BITRATES_KBPS;
    const kbps = mode < table.length ? table[mode] : undefined;
    const result: NonNullable<ParseResult> = {
        channels: 1,
        channelLayout: "mono",
        sampleRate: isWb ? 16000 : 8000,
        codec: isWb ? "AMR-WB" : "AMR-NB",
        sampleFormat: "compressed",
    };
    if (kbps !== undefined) {
        result.bitrate = Math.round(kbps * 1000);
        result.bitrateExact = true;
        result.bitrateMode = "cbr";
    }
    return result;
}
