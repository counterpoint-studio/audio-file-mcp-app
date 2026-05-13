import type { AudioMetadata } from "./metadata";
import { computeEffectiveBitrate } from "./metadata/effective-bitrate";

const SAMPLE_FORMAT_LABELS: Record<string, string> = {
    alaw: "A-law",
    mulaw: "μ-law",
    adpcm: "ADPCM",
    ima4: "IMA4",
};

export function basename(p: string): string {
    return p.slice(p.lastIndexOf("/") + 1);
}

function formatSampleRatePart(sr: number): string {
    const isWhole = sr % 1000 === 0;
    return `${(sr / 1000).toFixed(isWhole ? 0 : 1)}kHz`;
}

function formatBitratePart(
    bps: number,
    exact: boolean | undefined,
    mode: string | undefined,
): string {
    const kbps = Math.round(bps / 1000);
    const prefix = exact ? "" : "≈";
    const suffix = mode ? ` (${mode.toUpperCase()})` : "";
    return `${prefix}${kbps}kbps${suffix}`;
}

function formatQualifier(
    meta: AudioMetadata,
    audioDuration: number | undefined,
): string {
    if (meta.bitDepth !== undefined) {
        const isFloat = meta.sampleFormat === "pcm-float";
        return `${meta.bitDepth}bit${isFloat ? " float" : ""}`;
    }
    if (meta.sampleFormat && SAMPLE_FORMAT_LABELS[meta.sampleFormat]) {
        return SAMPLE_FORMAT_LABELS[meta.sampleFormat];
    }
    if (meta.bitrate !== undefined) {
        return formatBitratePart(meta.bitrate, meta.bitrateExact, meta.bitrateMode);
    }
    if (meta.sampleFormat === "compressed" && audioDuration !== undefined) {
        const eff = computeEffectiveBitrate(meta.sizeBytes, audioDuration);
        if (eff !== undefined) {
            return formatBitratePart(eff, false, meta.bitrateMode);
        }
    }
    return "";
}

function formatMidi(meta: AudioMetadata): string {
    const parts: string[] = [];
    if (meta.midiFormatType !== undefined) {
        parts.push(`format ${meta.midiFormatType}`);
    }
    if (meta.midiTrackCount !== undefined) {
        parts.push(`${meta.midiTrackCount} tracks`);
    }
    if (meta.midiDivision !== undefined) {
        const div = meta.midiDivision;
        parts.push(div < 0 ? "SMPTE timecode" : `${div} tpq`);
    }
    return parts.join(" / ");
}

export function formatSpec(
    meta: AudioMetadata | null,
    fallbackSampleRate: number | undefined,
    audioDuration: number | undefined,
): string {
    if (!meta) return "";

    const midi = formatMidi(meta);
    if (midi) return midi;

    const sr = meta.sampleRate ?? fallbackSampleRate;
    const srPart = sr !== undefined ? formatSampleRatePart(sr) : "";
    const qualifier = formatQualifier(meta, audioDuration);

    if (srPart && qualifier) return `${srPart} / ${qualifier}`;
    return srPart || qualifier;
}
