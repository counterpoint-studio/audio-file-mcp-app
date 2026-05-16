import audioType, { type AudioFormat } from "audio-type";

export type { AudioFormat };

const SNIFF_BASE64_CHARS = 88; // 88 base64 chars → 66 bytes, ≥ 64 required by audio-type

const FORMAT_MIME: Record<AudioFormat, string> = {
    wav: "audio/wav",
    aiff: "audio/aiff",
    mp3: "audio/mpeg",
    aac: "audio/aac",
    flac: "audio/flac",
    m4a: "audio/mp4",
    opus: "audio/ogg",
    oga: "audio/ogg",
    qoa: "audio/qoa",
    mid: "audio/midi",
    caf: "audio/x-caf",
    wma: "audio/x-ms-wma",
    amr: "audio/amr",
    webm: "audio/webm",
};

// Containers/codecs mediabunny can decode. The other entries in `FORMAT_MIME`
// stay supported for sniffing/MIME so the `unsupported` banner can still name
// them — they just don't decode.
const MEDIABUNNY_SUPPORTED: ReadonlySet<AudioFormat> = new Set<AudioFormat>([
    "wav",
    "mp3",
    "aac",
    "m4a",
    "flac",
    "opus",
    "oga",
    "webm",
]);

export function sniffAudioFormat(base64: string): AudioFormat | null {
    const headLen = Math.min(base64.length, SNIFF_BASE64_CHARS);
    const aligned = headLen - (headLen % 4);
    if (aligned < 4) return null;
    const head = Uint8Array.fromBase64(base64.slice(0, aligned));
    return audioType(head) ?? null;
}

export function audioFormatToMime(format: AudioFormat | null): string {
    return format ? FORMAT_MIME[format] : "application/octet-stream";
}

export function isMediabunnySupported(format: AudioFormat | null): boolean {
    return format !== null && MEDIABUNNY_SUPPORTED.has(format);
}
