import { formatTime } from "./time-display";
import type { WebAudioPlayer } from "./web-audio-player";

export type LoopRegion = {
    setPreview(p1: number, p2: number): void;
    setRegion(startSec: number, endSec: number): void;
    clearRegion(): void;
    destroy(): void;
};

// Neutral name so the observer reads as "region selection" rather than
// "loop region" — the model-context layer never frames the selection as a
// loop, even though this module name reflects its original use.
export type RegionObserver = {
    onPreview?(startSec: number, endSec: number): void;
    onCommit?(startSec: number, endSec: number): void;
    onCleared?(): void;
};

export function normalizeRegion(p1: number, p2: number): { start: number; end: number } {
    const a = Math.max(0, Math.min(1, p1));
    const b = Math.max(0, Math.min(1, p2));
    return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function createLoopRegion(
    audio: WebAudioPlayer,
    _seekBarEl: HTMLElement,
    regionEl: HTMLElement,
    statsEl: HTMLElement,
    startEl: HTMLElement,
    endEl: HTMLElement,
    observer?: RegionObserver,
): LoopRegion {
    let hasRegion = false;

    const setVars = (start: number, end: number) => {
        regionEl.style.setProperty("--loop-start", String(start));
        regionEl.style.setProperty("--loop-end", String(end));
    };

    regionEl.hidden = true;
    statsEl.hidden = true;
    setVars(0, 0);

    return {
        setPreview(p1, p2) {
            const { start, end } = normalizeRegion(p1, p2);
            setVars(start, end);
            regionEl.hidden = false;
            const { duration } = audio;
            if (Number.isFinite(duration) && duration > 0) {
                startEl.textContent = formatTime(start * duration);
                endEl.textContent = formatTime(end * duration);
                statsEl.hidden = false;
                observer?.onPreview?.(start * duration, end * duration);
            }
        },
        setRegion(startSec, endSec) {
            const { duration } = audio;
            if (!Number.isFinite(duration) || duration <= 0) {
                this.clearRegion();
                return;
            }
            const startClamped = Math.max(0, Math.min(duration, startSec));
            const endClamped = Math.max(0, Math.min(duration, endSec));
            const start = Math.min(startClamped, endClamped);
            const end = Math.max(startClamped, endClamped);
            hasRegion = true;
            audio.setLoopRegion(start, end);
            setVars(start / duration, end / duration);
            regionEl.hidden = false;
            startEl.textContent = formatTime(start);
            endEl.textContent = formatTime(end);
            statsEl.hidden = false;
            observer?.onCommit?.(start, end);
        },
        clearRegion() {
            hasRegion = false;
            audio.clearLoopRegion();
            regionEl.hidden = true;
            statsEl.hidden = true;
            startEl.textContent = "00:00.000";
            endEl.textContent = "00:00.000";
            setVars(0, 0);
            observer?.onCleared?.();
        },
        destroy() {
            // No persistent listeners: the facade owns loop-region playback.
        },
    };
}
