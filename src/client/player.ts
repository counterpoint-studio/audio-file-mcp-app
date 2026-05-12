import { type AudioDecodeFormat } from "./audio-formats";
import { createMetrics, type Metrics } from "./metrics";
import { createSeekBar, type SeekBar } from "./seek-bar";
import { createSpectrogram, type Spectrogram } from "./spectrogram";
import { createTimeDisplay, type TimeDisplay } from "./time-display";
import { createWaveform, type Waveform } from "./waveform";

export type Player = {
    destroy(): void;
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

    const timeDisplay: TimeDisplay = createTimeDisplay(audio, positionEl, durationEl);
    const seekBar: SeekBar = createSeekBar(audio, seekBarEl, timeDisplay.update);
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

    const onPlay = () => {
        button.textContent = "Pause";
    };

    const onPause = () => {
        button.textContent = "Play";
    };

    button.addEventListener("click", onClick);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    button.disabled = false;
    button.textContent = "Play";

    return {
        destroy() {
            // Tear down render layers (which may still hold the blob) before
            // the audio detaches and the URL is revoked.
            spectrogram.destroy();
            metrics.destroy();
            waveform.destroy();
            seekBar.destroy();
            timeDisplay.destroy();
            button.removeEventListener("click", onClick);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            button.disabled = true;
            button.textContent = "Play";
        },
    };
}
