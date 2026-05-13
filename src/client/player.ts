import { type AudioDecodeFormat } from "./audio-formats";
import { createLoopRegion, type LoopRegion, type RegionObserver } from "./loop-region";
import { createMetrics, type LiveMetrics, type Metrics } from "./metrics";
import { createSeekBar, type SeekBar } from "./seek-bar";
import { createSpectrogram, type Spectrogram } from "./spectrogram";
import { createTimeDisplay, type TimeDisplay } from "./time-display";
import { createWaveform, type Waveform } from "./waveform";

export type Player = {
    destroy(): void;
    audio: HTMLAudioElement;
    worker: Worker;
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

export function createPlayer(
    url: string,
    blob: Blob,
    decodeFormat: AudioDecodeFormat | null,
    button: HTMLButtonElement,
    seekBarEl: HTMLElement,
    positionEl: HTMLElement,
    durationEl: HTMLElement,
    spectrogramWrapEl: HTMLElement,
    durationSeconds: number | null,
    durationExact: boolean,
    observer?: PlayerObserver,
): Player {
    const audio = new Audio(url);
    audio.preload = "auto";
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
    const waveform: Waveform = createWaveform(
        blob,
        decodeFormat,
        seekBarEl,
        durationSeconds,
        durationExact,
    );
    const metrics: Metrics = createMetrics(waveform.worker, seekBarEl, audio);
    const spectrogram: Spectrogram = createSpectrogram(waveform.worker, spectrogramWrapEl);

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
        const message = err ? mediaErrorMessage(err) : undefined;
        observer?.onDecodeError?.("playback-unsupported", message);
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
        destroy() {
            // Tear down render layers (which may still hold the blob) before
            // the audio detaches and the URL is revoked.
            destroyed = true;
            if (observer) {
                waveform.worker.removeEventListener("message", onWorkerMessage);
            }
            spectrogram.destroy();
            metrics.destroy();
            waveform.destroy();
            loopRegion.destroy();
            seekBar.destroy();
            timeDisplay.destroy();
            button.removeEventListener("click", onClick);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("error", onAudioError);
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            button.disabled = true;
            setPlaying(false);
        },
    };
}

function mediaErrorMessage(err: MediaError): string {
    switch (err.code) {
        case 1: // MEDIA_ERR_ABORTED
            return "playback aborted";
        case 2: // MEDIA_ERR_NETWORK
            return "network error";
        case 3: // MEDIA_ERR_DECODE
            return "decode error";
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
            return "source not supported";
        default:
            return err.message || "";
    }
}
