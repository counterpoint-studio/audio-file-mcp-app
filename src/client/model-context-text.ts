import type { AudioMetadata } from "./metadata";
import { containerDisplayName } from "./metadata/container-name";
import { basename } from "./metadata-spec";

export type GlobalMetrics = {
    /** linear, 0..1+ */
    samplePeak: number;
    /** linear, 0..1+ */
    rms: number;
    /** already in dBTP */
    truePeakDb: number;
    /** already in LUFS */
    integratedLufs: number;
};

export type PositionSamples = {
    /** linear */
    samplePeak: number;
    /** linear */
    rms: number;
};

export type DecodeErrorKind =
    | "unsupported"
    | "decode-failed"
    | "playback-unsupported";

export type DecodeError = {
    kind: DecodeErrorKind;
    message?: string;
};

export type ContextState = {
    path: string | null;
    metadata: AudioMetadata | null;
    decoder: { channels?: number; sampleRate?: number };
    durationSeconds: number | null;
    globalMetrics: GlobalMetrics | null;
    playback: "playing" | "paused";
    positionSeconds: number;
    positionSamples: PositionSamples | null;
    region: { startSeconds: number; endSeconds: number } | null;
    error: DecodeError | null;
};

export function emptyContextState(): ContextState {
    return {
        path: null,
        metadata: null,
        decoder: {},
        durationSeconds: null,
        globalMetrics: null,
        playback: "paused",
        positionSeconds: 0,
        positionSamples: null,
        region: null,
        error: null,
    };
}

export function buildContextMarkdown(state: ContextState): string {
    if (state.path === null) return "";

    const lines: string[] = [];
    lines.push("---");
    lines.push(`file: ${state.path}`);

    const meta = state.metadata;
    if (meta) {
        pushIfDefined(lines, "format", containerDisplayName(meta.container));
        pushIfFiniteInt(lines, "size-bytes", meta.sizeBytes);
    }

    const channels = meta?.channels ?? state.decoder.channels;
    pushIfFiniteInt(lines, "channels", channels);

    const sampleRate = meta?.sampleRate ?? state.decoder.sampleRate;
    pushIfFiniteInt(lines, "sample-rate-hz", sampleRate);

    if (meta) {
        pushIfFiniteInt(lines, "bitrate-bps", meta.bitrate);
        if (meta.bitrateMode) {
            pushIfDefined(lines, "bitrate-mode", meta.bitrateMode);
        }
    }

    const duration = state.durationSeconds ?? meta?.duration;
    pushIfFiniteSeconds(lines, "duration-seconds", duration);

    if (state.globalMetrics) {
        const g = state.globalMetrics;
        pushDb(lines, "sample-peak-db", linearToDb(g.samplePeak));
        pushDb(lines, "true-peak-db", g.truePeakDb);
        pushDb(lines, "rms-db", linearToDb(g.rms));
        pushLufs(lines, "integrated-lufs", g.integratedLufs);
    }

    lines.push(`playback: ${state.playback}`);
    pushIfFiniteSeconds(lines, "position-seconds", state.positionSeconds);

    if (state.positionSamples) {
        pushDb(lines, "position-sample-peak-db", linearToDb(state.positionSamples.samplePeak));
        pushDb(lines, "position-rms-db", linearToDb(state.positionSamples.rms));
    }

    if (state.region) {
        pushIfFiniteSeconds(lines, "region-start-seconds", state.region.startSeconds);
        pushIfFiniteSeconds(lines, "region-end-seconds", state.region.endSeconds);
    }

    if (state.error) {
        lines.push(`error: ${state.error.kind}`);
        const msg = sanitizeErrorMessage(state.error.message);
        if (msg) {
            lines.push(`error-message: "${msg}"`);
        }
    }

    lines.push("---");
    lines.push("");
    lines.push(buildNarrative(state, channels, sampleRate, duration));

    return lines.join("\n");
}

function buildNarrative(
    state: ContextState,
    channels: number | undefined,
    sampleRate: number | undefined,
    duration: number | undefined,
): string {
    const sentences: string[] = [];

    const name = state.path ? basename(state.path) : "the file";
    const descParts: string[] = [];
    if (state.metadata) descParts.push(containerDisplayName(state.metadata.container));
    if (channels !== undefined && Number.isFinite(channels)) descParts.push(`${channels} ch`);
    if (sampleRate !== undefined && Number.isFinite(sampleRate)) {
        descParts.push(`${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
    }
    if (duration !== undefined && Number.isFinite(duration)) {
        descParts.push(`${duration.toFixed(2)} s`);
    }
    const desc = descParts.length > 0 ? ` (${descParts.join(", ")})` : "";
    sentences.push(`Loaded ${name}${desc}.`);

    const posText = Number.isFinite(state.positionSeconds)
        ? state.positionSeconds.toFixed(2)
        : "0.00";
    sentences.push(`Playback is currently ${state.playback} at ${posText} s.`);

    if (state.region) {
        const a = state.region.startSeconds.toFixed(2);
        const b = state.region.endSeconds.toFixed(2);
        sentences.push(`A region from ${a} s to ${b} s is selected.`);
    }

    if (state.error) {
        sentences.push(errorSentence(state.error));
    }

    return sentences.join(" ");
}

function errorSentence(error: DecodeError): string {
    const base =
        error.kind === "unsupported"
            ? "The file format is not supported."
            : error.kind === "playback-unsupported"
              ? "Playback of this file is not supported."
              : "The file could not be decoded.";
    const msg = sanitizeErrorMessage(error.message);
    if (!msg) return base;
    return `${base.slice(0, -1)} (${msg}).`;
}

function sanitizeErrorMessage(raw: string | undefined): string {
    if (!raw) return "";
    const collapsed = raw.replace(/[\r\n\t]+/g, " ").trim();
    return collapsed.replace(/"/g, '\\"');
}

function pushIfDefined(lines: string[], key: string, value: string | undefined | null): void {
    if (value === undefined || value === null || value === "") return;
    lines.push(`${key}: ${value}`);
}

function pushIfFiniteInt(lines: string[], key: string, value: number | undefined | null): void {
    if (value === undefined || value === null) return;
    if (!Number.isFinite(value)) return;
    lines.push(`${key}: ${Math.round(value)}`);
}

function pushIfFiniteSeconds(
    lines: string[],
    key: string,
    value: number | undefined | null,
): void {
    if (value === undefined || value === null) return;
    if (!Number.isFinite(value)) return;
    lines.push(`${key}: ${value.toFixed(2)}`);
}

function pushDb(lines: string[], key: string, db: number): void {
    if (Number.isNaN(db)) return;
    if (!Number.isFinite(db)) {
        lines.push(`${key}: -inf`);
        return;
    }
    lines.push(`${key}: ${db.toFixed(1)}`);
}

function pushLufs(lines: string[], key: string, lufs: number): void {
    if (Number.isNaN(lufs)) return;
    if (!Number.isFinite(lufs)) {
        lines.push(`${key}: -inf`);
        return;
    }
    lines.push(`${key}: ${lufs.toFixed(1)}`);
}

function linearToDb(linear: number): number {
    if (Number.isNaN(linear)) return NaN;
    if (linear === 0) return -Infinity;
    return 20 * Math.log10(Math.abs(linear));
}
