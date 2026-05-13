import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLoopRegion, type RegionObserver } from "./loop-region";

type EventListener = (e: unknown) => void;

function fakeAudio(duration = 100): HTMLAudioElement {
    const listeners = new Map<string, Set<EventListener>>();
    const a: Record<string, unknown> = {
        duration,
        currentTime: 0,
        paused: true,
        loop: false,
        addEventListener(type: string, fn: EventListener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: EventListener) {
            listeners.get(type)?.delete(fn);
        },
        play: vi.fn().mockResolvedValue(undefined),
    };
    return a as unknown as HTMLAudioElement;
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

beforeEach(() => {
    (globalThis as unknown as { requestAnimationFrame: (fn: () => void) => number })
        .requestAnimationFrame = () => 1;
    (globalThis as unknown as { cancelAnimationFrame: (id: number) => void })
        .cancelAnimationFrame = () => undefined;
});
afterEach(() => {
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
});

function setup(duration = 100) {
    const audio = fakeAudio(duration);
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
    return { audio, lr, observer };
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

    it("setRegion fires onCommit with clamped seconds", () => {
        const { lr, observer } = setup(100);
        lr.setRegion(120, 30); // out of bounds + reversed
        expect(observer.onCommit).toHaveBeenCalledWith(30, 100);
    });

    it("clearRegion fires onCleared", () => {
        const { lr, observer } = setup(100);
        lr.clearRegion();
        expect(observer.onCleared).toHaveBeenCalledTimes(1);
    });
});
