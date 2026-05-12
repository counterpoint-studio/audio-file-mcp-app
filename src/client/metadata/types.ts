import type { AudioFormat } from "../audio-formats";

export type SampleFormat =
    | "pcm-int"
    | "pcm-float"
    | "alaw"
    | "mulaw"
    | "adpcm"
    | "ima4"
    | "compressed";

export type BitrateMode = "cbr" | "vbr";

export type AudioMetadata = {
    container: AudioFormat;
    sizeBytes: number;
    channels?: number;
    channelLayout?: string;
    sampleRate?: number;
    inputSampleRate?: number;
    bitDepth?: number;
    sampleFormat?: SampleFormat;
    bitrate?: number;
    bitrateExact?: boolean;
    bitrateMode?: BitrateMode;
    codec?: string;
    midiFormatType?: 0 | 1 | 2;
    midiTrackCount?: number;
    midiDivision?: number;
};

export type ParseResult = Omit<AudioMetadata, "container" | "sizeBytes"> | null;
