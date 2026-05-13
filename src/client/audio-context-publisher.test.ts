import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAudioContextPublisher } from "./audio-context-publisher";
import type { ContextState } from "./model-context-text";
import type { AudioMetadata } from "./metadata";

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

function makeSubmit() {
    return vi.fn<(s: ContextState) => void>();
}

const META: AudioMetadata = {
    container: "flac",
    sizeBytes: 100,
    channels: 2,
    sampleRate: 44100,
    duration: 10,
    durationExact: true,
};

function lastState(submit: { mock: { calls: [ContextState][] } }): ContextState {
    return submit.mock.calls[submit.mock.calls.length - 1][0];
}

describe("createAudioContextPublisher", () => {
    it("setFile sends once with the file path in state", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit);
        pub.setFile("/abs/x.flac");
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][0].path).toBe("/abs/x.flac");
    });

    it("rapid setPosition during playback collapses to ~1 Hz; pause flushes immediately", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        pub.setPlayback("playing");
        const before = submit.mock.calls.length;

        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(100);
            pub.setPosition(i * 0.5, null);
        }
        expect(submit.mock.calls.length).toBe(before);

        vi.advanceTimersByTime(2000);
        expect(submit.mock.calls.length).toBe(before + 1);

        pub.setPosition(99, null);
        vi.advanceTimersByTime(50);
        pub.setPosition(99.5, null);
        const beforePause = submit.mock.calls.length;
        pub.setPlayback("paused");
        expect(submit.mock.calls.length).toBeGreaterThan(beforePause);
        expect(lastState(submit).playback).toBe("paused");
    });

    it("rapid setRegionPreview collapses; setRegion flushes immediately", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        const before = submit.mock.calls.length;
        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(50);
            pub.setRegionPreview(i, i + 1);
        }
        expect(submit.mock.calls.length).toBe(before);
        pub.setRegion(2, 5);
        expect(submit.mock.calls.length).toBe(before + 1);
        const s = lastState(submit);
        expect(s.region).toEqual({ startSeconds: 2, endSeconds: 5 });
    });

    it("clearRegion drops region from the next state", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit);
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        pub.setRegion(2, 5);
        pub.clearRegion();
        expect(lastState(submit).region).toBeNull();
    });

    it("submit throwing is caught and routed to logError without corrupting throttle", () => {
        const submit = vi
            .fn<(s: ContextState) => void>()
            .mockImplementationOnce(() => {
                throw new Error("boom");
            });
        const logError = vi.fn();
        const pub = createAudioContextPublisher(submit, { logError });
        pub.setFile("/x.flac");
        expect(logError).toHaveBeenCalledTimes(1);
        // Throttle state is still valid; further sends proceed.
        pub.setMetadata(META);
        expect(submit).toHaveBeenCalledTimes(2);
    });

    it("destroy cancels pending and ignores subsequent setters", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        vi.advanceTimersByTime(50);
        pub.setPosition(1, null);
        const before = submit.mock.calls.length;
        pub.destroy();
        vi.advanceTimersByTime(5000);
        pub.setMetadata(META);
        pub.setRegion(1, 2);
        expect(submit.mock.calls.length).toBe(before);
    });

    it("setError after setFile publishes state with error field", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit);
        pub.setFile("/x.mp3");
        pub.setError("decode-failed", "bad header");
        expect(lastState(submit).error).toEqual({
            kind: "decode-failed",
            message: "bad header",
        });
    });

    it("clearError drops error from the next state", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit);
        pub.setFile("/x.mp3");
        pub.setError("unsupported");
        pub.clearError();
        expect(lastState(submit).error).toBeNull();
    });

    it("setError before setFile does not send; first send after setFile carries the error", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit);
        pub.setError("unsupported");
        expect(submit).not.toHaveBeenCalled();
        pub.setFile("/x.bin");
        expect(lastState(submit).error).toEqual({ kind: "unsupported" });
    });

    it("destroy then setError is a no-op", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit);
        pub.setFile("/x.mp3");
        const before = submit.mock.calls.length;
        pub.destroy();
        pub.setError("decode-failed", "x");
        expect(submit.mock.calls.length).toBe(before);
    });

    it("skips publish when position rounds to the same 0.01 s with no samples", () => {
        const submit = makeSubmit();
        const pub = createAudioContextPublisher(submit, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        pub.setPlayback("paused");
        const before = submit.mock.calls.length;
        pub.setPosition(0, null);
        pub.setPosition(0.001, null);
        pub.setPosition(0.002, null);
        expect(submit.mock.calls.length).toBe(before);
    });
});
