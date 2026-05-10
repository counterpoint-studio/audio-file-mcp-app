import { createSeekBar, type SeekBar } from "./seek-bar";

export type Player = {
    destroy(): void;
};

export function createPlayer(
    url: string,
    button: HTMLButtonElement,
    seekBarEl: HTMLElement,
): Player {
    const audio = new Audio(url);
    audio.preload = "auto";

    const seekBar: SeekBar = createSeekBar(audio, seekBarEl);

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
            seekBar.destroy();
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
