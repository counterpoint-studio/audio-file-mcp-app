import type { AudioFormat } from "../audio-formats";

const NAMES: Record<AudioFormat, string> = {
    wav: "WAV (RIFF)",
    aiff: "AIFF",
    mp3: "MP3",
    aac: "AAC (ADTS)",
    flac: "FLAC",
    m4a: "M4A (MP4)",
    opus: "Ogg Opus",
    oga: "Ogg Vorbis",
    qoa: "QOA",
    mid: "MIDI",
    caf: "CAF",
    wma: "WMA (ASF)",
    amr: "AMR",
    webm: "WebM",
};

export function containerDisplayName(format: AudioFormat): string {
    return NAMES[format];
}
