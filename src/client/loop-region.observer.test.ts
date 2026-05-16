import { describe, it, expect, vi } from "vitest";
import { createLoopRegion, type RegionObserver } from "./loop-region";
import type { WebAudioPlayer } from "./web-audio-player";

function fakeAudio(duration = 100) {
    const setLoopRegion = vi.fn();
    const clearLoopRegion = vi.fn();
    const a: Record<string, unknown> = {
        duration,
        currentTime: 0,
        paused: true,
        loop: false,
        setLoopRegion,
        clearLoopRegion,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn().mockReturnValue(true),
    };
    return {
        audio: a as unknown as WebAudioPlayer,
        setLoopRegion,
        clearLoopRegion,
    };
}

function fakeEl(): HTMLElement {
    const e: Record<string, unknown> = {
        hidden: false,
        textContent: "",
        style: {
            setProperty: vi.fn(),
        },
    };
    return e as unknown as HTMLElement;
}

function setup(duration = 100) {
    const { audio, setLoopRegion, clearLoopRegion } = fakeAudio(duration);
    const seekBarEl = fakeEl();
    const regionEl = fakeEl();
    const statsEl = fakeEl();
    const startEl = fakeEl();
    const endEl = fakeEl();
    const observer: Required<RegionObserver> = {
        onPreview: vi.fn(),
        onCommit: vi.fn(),
        onCleared: vi.fn(),
    };
    const lr = createLoopRegion(
        audio,
        seekBarEl,
        regionEl,
        statsEl,
        startEl,
        endEl,
        observer,
    );
    return { audio, lr, observer, setLoopRegion, clearLoopRegion };
}

describe("createLoopRegion observer", () => {
    it("setPreview fires onPreview with seconds derived from duration", () => {
        const { lr, observer } = setup(100);
        lr.setPreview(0.2, 0.5);
        expect(observer.onPreview).toHaveBeenCalledWith(20, 50);
    });

    it("setPreview swaps order so start <= end", () => {
        const { lr, observer } = setup(100);
        lr.setPreview(0.7, 0.3);
        expect(observer.onPreview).toHaveBeenCalledWith(30, 70);
    });

    it("setPreview skips observer when duration is unknown", () => {
        const { audio, lr, observer } = setup(NaN);
        (audio as unknown as { duration: number }).duration = NaN;
        lr.setPreview(0.2, 0.5);
        expect(observer.onPreview).not.toHaveBeenCalled();
    });

    it("setRegion fires onCommit and delegates to facade", () => {
        const { lr, observer, setLoopRegion } = setup(100);
        lr.setRegion(120, 30); // out of bounds + reversed
        expect(observer.onCommit).toHaveBeenCalledWith(30, 100);
        expect(setLoopRegion).toHaveBeenCalledWith(30, 100);
    });

    it("clearRegion fires onCleared and delegates to facade", () => {
        const { lr, observer, clearLoopRegion } = setup(100);
        lr.clearRegion();
        expect(observer.onCleared).toHaveBeenCalledTimes(1);
        expect(clearLoopRegion).toHaveBeenCalled();
    });
});
