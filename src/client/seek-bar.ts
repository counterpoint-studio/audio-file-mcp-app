import { type LoopRegion, normalizeRegion } from "./loop-region";

export type SeekBar = {
    destroy(): void;
};

const LOOP_DRAG_PX = 4;

export function gestureKind(
    downX: number,
    currentX: number,
    threshold: number,
): "click" | "drag" {
    return Math.abs(currentX - downX) >= threshold ? "drag" : "click";
}

export function createSeekBar(
    audio: HTMLAudioElement,
    seekBarEl: HTMLElement,
    loopRegion: LoopRegion,
    onProgress?: (progress: number) => void,
): SeekBar {
    let rafId = 0;
    let gestureState: "idle" | "pressed" | "dragging" = "idle";
    let downX = 0;
    let downProgress = 0;
    let wasPlayingBeforeScrub = false;

    const setProgress = (p: number) => {
        seekBarEl.style.setProperty("--progress", String(p));
        onProgress?.(p);
    };

    const tick = () => {
        if (gestureState === "idle") {
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
        gestureState = "pressed";
        downX = e.clientX;
        downProgress = pointerToProgress(e);
        wasPlayingBeforeScrub = !audio.paused;
        if (wasPlayingBeforeScrub) audio.pause();
        audio.currentTime = downProgress * duration;
        setProgress(downProgress);
        loopRegion.clearRegion();
    };

    const onPointerMove = (e: PointerEvent) => {
        if (gestureState === "idle") return;
        const kind = gestureKind(downX, e.clientX, LOOP_DRAG_PX);
        if (gestureState === "pressed" && kind === "drag") {
            gestureState = "dragging";
        }
        if (gestureState === "dragging") {
            loopRegion.setPreview(downProgress, pointerToProgress(e));
        }
    };

    const onPointerUpOrCancel = (e: PointerEvent) => {
        if (gestureState === "idle") return;
        if (seekBarEl.hasPointerCapture(e.pointerId)) {
            seekBarEl.releasePointerCapture(e.pointerId);
        }
        const wasDragging = gestureState === "dragging";
        gestureState = "idle";
        wasPlayingBeforeScrub = false;
        if (e.type === "pointercancel") {
            if (wasDragging) loopRegion.clearRegion();
            return;
        }
        const { duration } = audio;
        if (!Number.isFinite(duration) || duration <= 0) return;
        if (wasDragging) {
            const { start, end } = normalizeRegion(downProgress, pointerToProgress(e));
            loopRegion.setRegion(start * duration, end * duration);
            audio.currentTime = start * duration;
            setProgress(start);
        }
        void audio.play();
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
            gestureState = "idle";
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
