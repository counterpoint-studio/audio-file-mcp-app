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

export async function extractMetadata(
    format: AudioFormat | null,
    blob: Blob,
): Promise<AudioMetadata | null> {
    if (!format) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parser = PARSERS[format];
    const parsed = parser ? parser(bytes) : null;
    return {
        container: format,
        sizeBytes: bytes.byteLength,
        ...(parsed ?? {}),
    };
}

export type { AudioMetadata, SampleFormat, BitrateMode, ParseResult } from "./types";
