export type SeekBar = {
    destroy(): void;
};

export function createSeekBar(
    audio: HTMLAudioElement,
    seekBarEl: HTMLElement,
    onProgress?: (progress: number) => void,
): SeekBar {
    let rafId = 0;
    let scrubbing = false;
    let wasPlayingBeforeScrub = false;

    const setProgress = (p: number) => {
        seekBarEl.style.setProperty("--progress", String(p));
        onProgress?.(p);
    };

    const tick = () => {
        if (!scrubbing) {
            const { currentTime, duration } = audio;
            if (Number.isFinite(duration) && duration > 0) {
                setProgress(currentTime / duration);
            }
        }
        rafId = requestAnimationFrame(tick);
    };

    const startRaf = () => {
        if (rafId === 0) {
            rafId = requestAnimationFrame(tick);
        }
    };

    const stopRaf = () => {
        if (rafId !== 0) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    };

    const onPlay = () => startRaf();
    const onPause = () => stopRaf();

    const pointerToProgress = (e: PointerEvent): number => {
        const rect = seekBarEl.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const x = e.clientX - rect.left;
        return Math.max(0, Math.min(1, x / rect.width));
    };

    const seekToPointerImmediate = (e: PointerEvent) => {
        const { duration } = audio;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const p = pointerToProgress(e);
        audio.currentTime = p * duration;
        setProgress(p);
    };

    const isPlayPauseTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Element)) return false;
        return target.closest("#play-pause") !== null;
    };

    const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if (isPlayPauseTarget(e.target)) return;
        const { duration } = audio;
        if (!Number.isFinite(duration) || duration <= 0) return;
        seekBarEl.setPointerCapture(e.pointerId);
        scrubbing = true;
        wasPlayingBeforeScrub = !audio.paused;
        if (wasPlayingBeforeScrub) audio.pause();
        seekToPointerImmediate(e);
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!seekBarEl.hasPointerCapture(e.pointerId)) return;
        seekToPointerImmediate(e);
    };

    const onPointerUpOrCancel = (e: PointerEvent) => {
        if (!scrubbing) return;
        if (seekBarEl.hasPointerCapture(e.pointerId)) {
            seekBarEl.releasePointerCapture(e.pointerId);
        }
        scrubbing = false;
        wasPlayingBeforeScrub = false;
        if (e.type !== "pointercancel") {
            void audio.play();
        }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    seekBarEl.addEventListener("pointerdown", onPointerDown);
    seekBarEl.addEventListener("pointermove", onPointerMove);
    seekBarEl.addEventListener("pointerup", onPointerUpOrCancel);
    seekBarEl.addEventListener("pointercancel", onPointerUpOrCancel);

    setProgress(0);

    return {
        destroy() {
            stopRaf();
            scrubbing = false;
            wasPlayingBeforeScrub = false;
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            seekBarEl.removeEventListener("pointerdown", onPointerDown);
            seekBarEl.removeEventListener("pointermove", onPointerMove);
            seekBarEl.removeEventListener("pointerup", onPointerUpOrCancel);
            seekBarEl.removeEventListener("pointercancel", onPointerUpOrCancel);
            setProgress(0);
        },
    };
}
