import audioType, { type AudioFormat } from "audio-type";

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

export function sniffAudioMime(base64: string): string {
    const headLen = Math.min(base64.length, SNIFF_BASE64_CHARS);
    const aligned = headLen - (headLen % 4);
    if (aligned < 4) return "application/octet-stream";
    const head = Uint8Array.fromBase64(base64.slice(0, aligned));
    const fmt = audioType(head);
    return fmt ? FORMAT_MIME[fmt] : "application/octet-stream";
}
