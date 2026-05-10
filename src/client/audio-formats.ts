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

// `audio-decode`'s sub-decoder keys. MIDI is intentionally absent — no PCM to render.
export type AudioDecodeFormat =
    | "wav"
    | "aiff"
    | "mp3"
    | "aac"
    | "flac"
    | "vorbis"
    | "opus"
    | "qoa"
    | "caf"
    | "wma"
    | "amr"
    | "webm";

// Direct route from sniffed format to the audio-decode sub-decoder, no MIME detour.
// Routing here means we pick "opus" vs "vorbis" upfront for OGG containers, since
// audio-type already disambiguated them at sniff time.
const FORMAT_DECODE: Record<AudioFormat, AudioDecodeFormat | null> = {
    wav: "wav",
    aiff: "aiff",
    mp3: "mp3",
    aac: "aac",
    flac: "flac",
    m4a: "aac", // M4A container, AAC payload
    opus: "opus",
    oga: "vorbis", // OGG with Vorbis payload
    qoa: "qoa",
    mid: null, // MIDI: no PCM, no waveform
    caf: "caf",
    wma: "wma",
    amr: "amr",
    webm: "webm",
};

// Sub-decoders that support the streaming (ReadableStream → AsyncIterable) form.
// AAC is excluded due to audio-decode issues #44/#45 (browser stream chunk size).
export const STREAMABLE_DECODE_FORMATS: ReadonlySet<AudioDecodeFormat> = new Set([
    "mp3",
    "wav",
    "flac",
    "vorbis",
    "opus",
    "aiff",
    "qoa",
    "caf",
    "amr",
    "wma",
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

export function audioFormatToDecodeFormat(
    format: AudioFormat | null,
): AudioDecodeFormat | null {
    return format ? FORMAT_DECODE[format] : null;
}
