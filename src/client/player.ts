import { type AudioDecodeFormat } from "./audio-formats";
import { createLoopRegion, type LoopRegion } from "./loop-region";
import { createMetrics, type Metrics } from "./metrics";
import { createSeekBar, type SeekBar } from "./seek-bar";
import { createSpectrogram, type Spectrogram } from "./spectrogram";
import { createTimeDisplay, type TimeDisplay } from "./time-display";
import { createWaveform, type Waveform } from "./waveform";

export type Player = {
    destroy(): void;
    audio: HTMLAudioElement;
    worker: Worker;
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
): Player {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.loop = true;

    const regionEl = requireChild(seekBarEl, "#loop-region");
    const regionStatsEl = requireChild(seekBarEl, "#loop-region-stats");
    const regionStartEl = requireChild(seekBarEl, "#loop-start-time");
    const regionEndEl = requireChild(seekBarEl, "#loop-end-time");

    const timeDisplay: TimeDisplay = createTimeDisplay(audio, positionEl, durationEl);
    const loopRegion: LoopRegion = createLoopRegion(
        audio,
        seekBarEl,
        regionEl,
        regionStatsEl,
        regionStartEl,
        regionEndEl,
    );
    const seekBar: SeekBar = createSeekBar(audio, seekBarEl, loopRegion, timeDisplay.update);
    const waveform: Waveform = createWaveform(blob, decodeFormat, audio, seekBarEl);
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

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    button.addEventListener("click", onClick);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

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
            spectrogram.destroy();
            metrics.destroy();
            waveform.destroy();
            loopRegion.destroy();
            seekBar.destroy();
            timeDisplay.destroy();
            button.removeEventListener("click", onClick);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            button.disabled = true;
            setPlaying(false);
        },
    };
}
