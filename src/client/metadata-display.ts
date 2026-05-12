import type { AudioMetadata } from "./metadata";
import { containerDisplayName } from "./metadata/container-name";
import { computeEffectiveBitrate } from "./metadata/effective-bitrate";

export type MetadataDisplay = {
    update(m: AudioMetadata | null, path: string): void;
    destroy(): void;
};

type Row = { wrapper: HTMLElement; dd: HTMLElement };

type Rows = {
    path: Row;
    container: Row;
    size: Row;
    channels: Row;
    sampleRate: Row;
    bitDepth: Row;
    sampleFormat: Row;
    codec: Row;
    bitrate: Row;
    midiFormat: Row;
    midiTracks: Row;
    midiDivision: Row;
};

const SAMPLE_FORMAT_LABELS: Record<string, string> = {
    "pcm-int": "PCM-int",
    "pcm-float": "PCM-float",
    alaw: "A-law",
    mulaw: "μ-law",
    adpcm: "ADPCM",
    ima4: "IMA4",
    compressed: "Compressed",
};

function readRow(rootEl: HTMLElement, ddId: string): Row {
    const dd = rootEl.querySelector<HTMLElement>(`#${ddId}`);
    if (!dd) throw new Error(`metadata-display: missing #${ddId}`);
    const wrapper = dd.parentElement;
    if (!wrapper) throw new Error(`metadata-display: #${ddId} has no wrapper`);
    return { wrapper, dd };
}

function readRows(rootEl: HTMLElement): Rows {
    return {
        path: readRow(rootEl, "md-path"),
        container: readRow(rootEl, "md-container"),
        size: readRow(rootEl, "md-size"),
        channels: readRow(rootEl, "md-channels"),
        sampleRate: readRow(rootEl, "md-samplerate"),
        bitDepth: readRow(rootEl, "md-bitdepth"),
        sampleFormat: readRow(rootEl, "md-sampleformat"),
        codec: readRow(rootEl, "md-codec"),
        bitrate: readRow(rootEl, "md-bitrate"),
        midiFormat: readRow(rootEl, "md-midi-format"),
        midiTracks: readRow(rootEl, "md-midi-tracks"),
        midiDivision: readRow(rootEl, "md-midi-division"),
    };
}

function setRow(row: Row, value: string | null): void {
    if (value === null) {
        row.wrapper.hidden = true;
        row.dd.textContent = "";
        return;
    }
    row.wrapper.hidden = false;
    row.dd.textContent = value;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSampleRate(hz: number, inputHz?: number): string {
    const primary = `${hz.toLocaleString("en-US").replace(/,/g, " ")} Hz`;
    if (inputHz !== undefined && inputHz !== hz) {
        const input = inputHz.toLocaleString("en-US").replace(/,/g, " ");
        return `${primary} (input ${input} Hz)`;
    }
    return primary;
}

function formatChannels(channels: number, layout?: string): string {
    if (layout && layout !== `${channels}-channel`) return `${channels} (${layout})`;
    return String(channels);
}

function formatBitrate(bps: number, exact: boolean | undefined, mode: string | undefined): string {
    const kbps = Math.round(bps / 1000);
    const prefix = exact ? "" : "≈ ";
    const suffix = mode ? ` (${mode.toUpperCase()})` : "";
    return `${prefix}${kbps} kbps${suffix}`;
}

export function createMetadataDisplay(
    rootEl: HTMLElement,
    audio: HTMLAudioElement,
    worker: Worker,
): MetadataDisplay {
    const rows = readRows(rootEl);
    let current: AudioMetadata | null = null;
    let currentPath = "";
    // Holds channels/sampleRate fallback from the worker, if metadata missed them.
    let decoderChannels: number | undefined;
    let decoderSampleRate: number | undefined;

    function render(): void {
        setRow(rows.path, currentPath || "—");
        if (!current) {
            setRow(rows.container, "—");
            setRow(rows.size, "—");
            setRow(rows.channels, null);
            setRow(rows.sampleRate, null);
            setRow(rows.bitDepth, null);
            setRow(rows.sampleFormat, null);
            setRow(rows.codec, null);
            setRow(rows.bitrate, null);
            setRow(rows.midiFormat, null);
            setRow(rows.midiTracks, null);
            setRow(rows.midiDivision, null);
            return;
        }
        setRow(rows.container, containerDisplayName(current.container));
        setRow(rows.size, formatSize(current.sizeBytes));

        const effChannels = current.channels ?? decoderChannels;
        if (effChannels !== undefined) {
            setRow(rows.channels, formatChannels(effChannels, current.channelLayout));
        } else {
            setRow(rows.channels, null);
        }

        const effSampleRate = current.sampleRate ?? decoderSampleRate;
        if (effSampleRate !== undefined) {
            setRow(rows.sampleRate, formatSampleRate(effSampleRate, current.inputSampleRate));
        } else {
            setRow(rows.sampleRate, null);
        }

        if (current.bitDepth !== undefined) {
            setRow(rows.bitDepth, String(current.bitDepth));
        } else {
            setRow(rows.bitDepth, null);
        }

        if (current.sampleFormat !== undefined && current.sampleFormat !== "compressed") {
            setRow(rows.sampleFormat, SAMPLE_FORMAT_LABELS[current.sampleFormat] ?? current.sampleFormat);
        } else {
            setRow(rows.sampleFormat, null);
        }

        if (current.codec !== undefined) {
            setRow(rows.codec, current.codec);
        } else {
            setRow(rows.codec, null);
        }

        const bps = current.bitrate;
        if (bps !== undefined) {
            setRow(rows.bitrate, formatBitrate(bps, current.bitrateExact, current.bitrateMode));
        } else if (
            current.sampleFormat === "compressed" &&
            audio.duration &&
            Number.isFinite(audio.duration)
        ) {
            const eff = computeEffectiveBitrate(current.sizeBytes, audio.duration);
            if (eff !== undefined) {
                setRow(rows.bitrate, formatBitrate(eff, false, current.bitrateMode));
            } else {
                setRow(rows.bitrate, null);
            }
        } else {
            setRow(rows.bitrate, null);
        }

        if (current.midiFormatType !== undefined) {
            setRow(rows.midiFormat, String(current.midiFormatType));
        } else {
            setRow(rows.midiFormat, null);
        }
        if (current.midiTrackCount !== undefined) {
            setRow(rows.midiTracks, String(current.midiTrackCount));
        } else {
            setRow(rows.midiTracks, null);
        }
        if (current.midiDivision !== undefined) {
            const div = current.midiDivision;
            // Negative (high bit set on the unsigned read) means SMPTE timecode.
            const label = div < 0 ? "SMPTE timecode" : String(div);
            setRow(rows.midiDivision, label);
        } else {
            setRow(rows.midiDivision, null);
        }
    }

    const onWorkerMessage = (e: MessageEvent): void => {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type !== "decoder-info") return;
        decoderChannels = data.channels;
        decoderSampleRate = data.sampleRate;
        render();
    };
    worker.addEventListener("message", onWorkerMessage);

    const onLoadedMetadata = (): void => {
        // Once duration becomes known, re-render so the ≈ bitrate fallback
        // can fill in. (Audio fields don't otherwise depend on duration.)
        render();
    };
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    render();

    return {
        update(m, path) {
            current = m;
            currentPath = path;
            decoderChannels = undefined;
            decoderSampleRate = undefined;
            render();
        },
        destroy() {
            worker.removeEventListener("message", onWorkerMessage);
            audio.removeEventListener("loadedmetadata", onLoadedMetadata);
            current = null;
            currentPath = "";
            decoderChannels = undefined;
            decoderSampleRate = undefined;
            render();
        },
    };
}
