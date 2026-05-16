import audioType, { type AudioFormat } from "audio-type";

export type { AudioFormat };

// Containers/codecs mediabunny can decode. Other formats are still sniffed so
// the `unsupported` banner can name them; they just don't decode.
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

export function sniffAudioFormatBytes(bytes: Uint8Array): AudioFormat | null {
    return audioType(bytes) ?? null;
}

export function isMediabunnySupported(format: AudioFormat | null): boolean {
    return format !== null && MEDIABUNNY_SUPPORTED.has(format);
}
