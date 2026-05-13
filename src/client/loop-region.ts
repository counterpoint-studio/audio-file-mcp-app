import { formatTime } from "./time-display";

export type LoopRegion = {
    setPreview(p1: number, p2: number): void;
    setRegion(startSec: number, endSec: number): void;
    clearRegion(): void;
    destroy(): void;
};

export function normalizeRegion(p1: number, p2: number): { start: number; end: number } {
    const a = Math.max(0, Math.min(1, p1));
    const b = Math.max(0, Math.min(1, p2));
    return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function enforceLoop(
    currentTime: number,
    loopStart: number,
    loopEnd: number,
): number | null {
    if (!(loopEnd > loopStart)) return null;
    if (currentTime >= loopEnd) return loopStart;
    if (currentTime < loopStart) return loopStart;
    return null;
}

export function createLoopRegion(
    audio: HTMLAudioElement,
    _seekBarEl: HTMLElement,
    regionEl: HTMLElement,
    statsEl: HTMLElement,
    startEl: HTMLElement,
    endEl: HTMLElement,
): LoopRegion {
    let rafId = 0;
    let loopStartSec = 0;
    let loopEndSec = 0;
    let hasRegion = false;

    const setVars = (start: number, end: number) => {
        regionEl.style.setProperty("--loop-start", String(start));
        regionEl.style.setProperty("--loop-end", String(end));
    };

    const tick = () => {
        if (hasRegion && !audio.paused) {
            const corrected = enforceLoop(audio.currentTime, loopStartSec, loopEndSec);
            if (corrected !== null) {
                audio.currentTime = corrected;
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

    const onEnded = () => {
        if (hasRegion) {
            audio.currentTime = loopStartSec;
            void audio.play();
        }
    };

    audio.addEventListener("ended", onEnded);

    audio.loop = true;
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
            loopStartSec = start;
            loopEndSec = end;
            hasRegion = true;
            audio.loop = false;
            setVars(start / duration, end / duration);
            regionEl.hidden = false;
            startEl.textContent = formatTime(start);
            endEl.textContent = formatTime(end);
            statsEl.hidden = false;
            startRaf();
        },
        clearRegion() {
            audio.loop = true;
            regionEl.hidden = true;
            statsEl.hidden = true;
            startEl.textContent = "00:00.000";
            endEl.textContent = "00:00.000";
            setVars(0, 0);
            loopStartSec = 0;
            loopEndSec = 0;
            hasRegion = false;
            stopRaf();
        },
        destroy() {
            stopRaf();
            audio.removeEventListener("ended", onEnded);
        },
    };
}
