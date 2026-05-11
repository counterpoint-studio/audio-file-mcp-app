export type SeekBar = {
    destroy(): void;
};

export function createSeekBar(
    audio: HTMLAudioElement,
    seekBarEl: HTMLElement,
    onProgress?: (progress: number) => void,
): SeekBar {
    let rafId = 0;
    let pendingSeekTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSeekProgress: number | null = null;
    let scrubbing = false;

    const setProgress = (p: number) => {
        seekBarEl.style.setProperty("--progress", String(p));
        onProgress?.(p);
    };

    const cancelPendingSeek = () => {
        if (pendingSeekTimer !== null) {
            clearTimeout(pendingSeekTimer);
            pendingSeekTimer = null;
        }
        pendingSeekProgress = null;
    };

    const flushPendingSeek = () => {
        const p = pendingSeekProgress;
        cancelPendingSeek();
        if (p === null) return;
        const { duration } = audio;
        if (!Number.isFinite(duration) || duration <= 0) return;
        audio.currentTime = p * duration;
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
        cancelPendingSeek();
        audio.currentTime = p * duration;
        setProgress(p);
    };

    const seekToPointerDebounced = (e: PointerEvent) => {
        const { duration } = audio;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const p = pointerToProgress(e);
        setProgress(p);
        pendingSeekProgress = p;
        if (pendingSeekTimer !== null) clearTimeout(pendingSeekTimer);
        pendingSeekTimer = setTimeout(() => {
            pendingSeekTimer = null;
            flushPendingSeek();
        }, 40);
    };

    const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const { duration } = audio;
        if (!Number.isFinite(duration) || duration <= 0) return;
        seekBarEl.setPointerCapture(e.pointerId);
        scrubbing = true;
        seekToPointerImmediate(e);
        if (audio.paused) {
            void audio.play();
        }
    };

    const onPointerMove = (e: PointerEvent) => {
        if (!seekBarEl.hasPointerCapture(e.pointerId)) return;
        seekToPointerDebounced(e);
    };

    const onPointerUpOrCancel = (e: PointerEvent) => {
        if (seekBarEl.hasPointerCapture(e.pointerId)) {
            seekBarEl.releasePointerCapture(e.pointerId);
        }
        flushPendingSeek();
        scrubbing = false;
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
            cancelPendingSeek();
            scrubbing = false;
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
