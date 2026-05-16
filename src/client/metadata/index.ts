import { type AudioFormat } from "../audio-formats";
import type { AudioMetadata, ParseResult } from "./types";
import { parseWav } from "./wav";
import { parseAiff } from "./aiff";
import { parseFlac } from "./flac";
import { parseCaf } from "./caf";
import { parseAmr } from "./amr";
import { parseQoa } from "./qoa";
import { parseMidi } from "./midi";
import { parseMp3 } from "./mp3";
import { parseOgg } from "./ogg";
import { parseAac } from "./aac";
import { parseM4a } from "./m4a";
import { parseWebm } from "./webm";
import { parseWma } from "./wma";
import { computeEstimatedDuration } from "./effective-bitrate";

type Parser = (bytes: Uint8Array) => ParseResult;

const PARSERS: Partial<Record<AudioFormat, Parser>> = {
    wav: parseWav,
    aiff: parseAiff,
    flac: parseFlac,
    caf: parseCaf,
    amr: parseAmr,
    qoa: parseQoa,
    mid: parseMidi,
    mp3: parseMp3,
    aac: parseAac,
    m4a: parseM4a,
    opus: parseOgg,
    oga: parseOgg,
    webm: parseWebm,
    wma: parseWma,
};

export const METADATA_HEADER_BYTES = 1 << 20;

export function extractMetadata(
    format: AudioFormat | null,
    headerBytes: Uint8Array,
    sizeBytes: number,
): AudioMetadata | null {
    if (!format) return null;
    const parser = PARSERS[format];
    const parsed = parser ? parser(headerBytes) : null;
    const meta: AudioMetadata = {
        container: format,
        sizeBytes,
        ...(parsed ?? {}),
    };
    if (meta.duration === undefined && meta.bitrate !== undefined) {
        const est = computeEstimatedDuration(meta.sizeBytes, meta.bitrate);
        if (est !== undefined) {
            meta.duration = est;
            meta.durationExact = false;
        }
    }
    return meta;
}

export type { AudioMetadata, SampleFormat, BitrateMode, ParseResult } from "./types";
