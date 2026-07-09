import type { Source } from "mediabunny";
import type { AnalysisWorker } from "./analysis-worker-factory";
import { createAnnotationBand } from "./annotation-band";
import type { AnnotationData } from "../shared/annotation-data";
import { type AudioFormat } from "./audio-formats";
import { createLoopRegion, type LoopRegion, type RegionObserver } from "./loop-region";
import { createMetrics, type LiveMetrics, type Metrics } from "./metrics";
import { createSeekBar, type SeekBar } from "./seek-bar";
import { createSpectrogram, type Spectrogram } from "./spectrogram";
import { createTimeDisplay, type TimeDisplay } from "./time-display";
import { createWaveform, type Waveform } from "./waveform";
import { createWebAudioPlayer, type WebAudioPlayer } from "./web-audio-player";
import type { ChunkStore } from "./chunk-store";
import type { ChunkBus } from "./chunk-bus";
import type { ChunkLoader } from "./chunk-loader";

export type Player = {
    destroy(): void;
    audio: WebAudioPlayer;
    worker: AnalysisWorker;
    loopRegion: LoopRegion;
};

export type PlayerPositionSamples = {
    /** linear */
    samplePeak: number;
    /** linear */
    rms: number;
};

export type PlayerDecodeErrorKind =
    | "unsupported"
    | "decode-failed"
    | "playback-unsupported";

export type PlayerObserver = {
    onPlayback?(playing: boolean): void;
    onPosition?(seconds: number, samples: PlayerPositionSamples | null): void;
    onLiveMetrics?(m: LiveMetrics): void;
    onDecoderInfo?(channels: number | undefined, sampleRate: number | undefined): void;
    onRegionPreview?(startSec: number, endSec: number): void;
    onRegion?(startSec: number, endSec: number): void;
    onRegionCleared?(): void;
    onDecodeError?(kind: PlayerDecodeErrorKind, message?: string): void;
};

export async function createPlayer(
    source: Source,
    chunkStore: ChunkStore,
    chunkBus: ChunkBus,
    loader: Pick<ChunkLoader, "request">,
    format: AudioFormat | null,
    button: HTMLButtonElement,
    seekBarEl: HTMLElement,
    positionEl: HTMLElement,
    durationEl: HTMLElement,
    spectrogramWrapEl: HTMLElement,
    annotationBandEl: HTMLElement,
    annotations: AnnotationData | null,
    durationSeconds: number | null,
    durationExact: boolean,
    observer?: PlayerObserver,
): Promise<Player> {
    const audio = createWebAudioPlayer(source);
    audio.loop = true;

    const regionEl = requireChild(seekBarEl, "#loop-region");
    const regionStatsEl = requireChild(seekBarEl, "#loop-region-stats");
    const regionStartEl = requireChild(seekBarEl, "#loop-start-time");
    const regionEndEl = requireChild(seekBarEl, "#loop-end-time");

    const timeDisplay: TimeDisplay = createTimeDisplay(audio, positionEl, durationEl);
    const regionObserver: RegionObserver | undefined = observer
        ? {
              onPreview: observer.onRegionPreview,
              onCommit: observer.onRegion,
              onCleared: observer.onRegionCleared,
          }
        : undefined;
    const loopRegion: LoopRegion = createLoopRegion(
        audio,
        seekBarEl,
        regionEl,
        regionStatsEl,
        regionStartEl,
        regionEndEl,
        regionObserver,
    );
    const seekBar: SeekBar = createSeekBar(audio, seekBarEl, loopRegion, timeDisplay.update);
    const waveform: Waveform = await createWaveform(
        chunkStore,
        chunkBus,
        loader,
        format,
        seekBarEl,
        durationSeconds,
        durationExact,
    );
    const metrics: Metrics = createMetrics(waveform.worker, seekBarEl, audio);
    const spectrogram: Spectrogram = createSpectrogram(waveform.worker, spectrogramWrapEl);

    // Static SVG lanes between waveform and spectrogram, keyed to the audio's
    // own duration so spans align with the playhead. Duration may not be known
    // yet; refine it from `loadedmetadata`.
    const annotationBand = createAnnotationBand(
        annotationBandEl,
        annotations,
        durationSeconds ?? 0,
    );
    const onLoadedMetadata = () => annotationBand.setDuration(audio.duration);
    if (audio.readyState >= 1 && Number.isFinite(audio.duration)) {
        annotationBand.setDuration(audio.duration);
    }
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    const onClick = () => {
        if (audio.paused) {
            void audio.play();
        } else {
            audio.pause();
        }
    };

    const setPlaying = (playing: boolean) => {
        button.classList.toggle("is-playing", playing);
        button.setAttribute("aria-label", playing ? "Pause" : "Play");
    };

    let latestPositionSamples: PlayerPositionSamples | null = null;
    let nextPlayheadQueryId = -1;
    let pendingPlayheadQueryId = 0;

    const onPlay = () => {
        setPlaying(true);
        observer?.onPlayback?.(true);
    };
    const onPause = () => {
        setPlaying(false);
        observer?.onPlayback?.(false);
        observer?.onPosition?.(audio.currentTime, latestPositionSamples);
    };

    const onTimeUpdate = () => {
        observer?.onPosition?.(audio.currentTime, latestPositionSamples);
        if (observer?.onPosition || observer?.onLiveMetrics) {
            pendingPlayheadQueryId = nextPlayheadQueryId--;
            waveform.worker.postMessage({
                type: "queryAt",
                id: pendingPlayheadQueryId,
                seconds: audio.currentTime,
            });
        }
    };

    let destroyed = false;

    const onWorkerMessage = (e: MessageEvent) => {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "live-metrics" || data.type === "final-metrics") {
            observer?.onLiveMetrics?.(data.metrics as LiveMetrics);
        } else if (data.type === "decoder-info") {
            observer?.onDecoderInfo?.(data.channels, data.sampleRate);
        } else if (data.type === "query-result") {
            if (typeof data.id === "number" && data.id < 0) {
                if (data.id !== pendingPlayheadQueryId) return;
                const v = data.values as { samplePeak: number; rms: number } | null;
                latestPositionSamples = v
                    ? { samplePeak: v.samplePeak, rms: v.rms }
                    : null;
            }
        } else if (data.type === "error") {
            observer?.onDecodeError?.(
                "decode-failed",
                typeof data.message === "string" ? data.message : undefined,
            );
        } else if (data.type === "done" && data.reason === "unsupported") {
            observer?.onDecodeError?.("unsupported");
        }
    };

    const onAudioError = () => {
        if (destroyed) return;
        const err = audio.error;
        if (!err) {
            observer?.onDecodeError?.("playback-unsupported");
            return;
        }
        const kind: PlayerDecodeErrorKind =
            err.kind === "unsupported" ? "unsupported" : "decode-failed";
        observer?.onDecodeError?.(kind, err.message || undefined);
    };

    button.addEventListener("click", onClick);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("error", onAudioError);
    if (observer) {
        waveform.worker.addEventListener("message", onWorkerMessage);
    }

    button.disabled = false;
    setPlaying(false);

    function requireChild(parent: HTMLElement, selector: string): HTMLElement {
        const el = parent.querySelector<HTMLElement>(selector);
        if (!el) throw new Error(`${selector} element missing`);
        return el;
    }

    return {
        audio,
        worker: waveform.worker,
        loopRegion,
        destroy() {
            // Tear down render layers (which may still hold the blob) before
            // the audio detaches and the URL is revoked.
            destroyed = true;
            if (observer) {
                waveform.worker.removeEventListener("message", onWorkerMessage);
            }
            spectrogram.destroy();
            annotationBand.destroy();
            metrics.destroy();
            waveform.destroy();
            loopRegion.destroy();
            seekBar.destroy();
            timeDisplay.destroy();
            button.removeEventListener("click", onClick);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("loadedmetadata", onLoadedMetadata);
            audio.removeEventListener("error", onAudioError);
            audio.pause();
            audio.destroy();
            button.disabled = true;
            setPlaying(false);
        },
    };
}
