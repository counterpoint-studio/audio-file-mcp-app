import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAudioContextPublisher } from "./audio-context-publisher";
import type { AudioMetadata } from "./metadata";

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

function makeApp() {
    return {
        updateModelContext: vi.fn().mockResolvedValue({}),
    };
}

const META: AudioMetadata = {
    container: "flac",
    sizeBytes: 100,
    channels: 2,
    sampleRate: 44100,
    duration: 10,
    durationExact: true,
};

describe("createAudioContextPublisher", () => {
    it("setFile sends once with the file path", () => {
        const app = makeApp();
        const pub = createAudioContextPublisher(app);
        pub.setFile("/abs/x.flac");
        expect(app.updateModelContext).toHaveBeenCalledTimes(1);
        const args = app.updateModelContext.mock.calls[0][0];
        const text = args.content[0].text as string;
        expect(text).toContain("file: /abs/x.flac");
    });

    it("rapid setPosition during playback collapses to ~1 Hz; pause flushes immediately", () => {
        const app = makeApp();
        const pub = createAudioContextPublisher(app, { minIntervalMs: 1000 });
        pub.setFile("/x.flac"); // 1 send
        pub.setMetadata(META); // 2nd send
        pub.setPlayback("playing"); // 3rd send (immediate)
        const before = app.updateModelContext.mock.calls.length;

        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(100);
            pub.setPosition(i * 0.5, null);
        }
        // Within the 1 s window after the playing transition, no extra calls
        expect(app.updateModelContext.mock.calls.length).toBe(before);

        // Trailing arrives after the window
        vi.advanceTimersByTime(2000);
        expect(app.updateModelContext.mock.calls.length).toBe(before + 1);

        // Now do another round and pause flushes the trailing
        pub.setPosition(99, null);
        vi.advanceTimersByTime(50);
        pub.setPosition(99.5, null);
        const beforePause = app.updateModelContext.mock.calls.length;
        pub.setPlayback("paused");
        expect(app.updateModelContext.mock.calls.length).toBeGreaterThan(beforePause);
        const lastCall = app.updateModelContext.mock.calls[
            app.updateModelContext.mock.calls.length - 1
        ][0];
        expect((lastCall.content[0].text as string)).toContain("playback: paused");
    });

    it("rapid setRegionPreview collapses; setRegion flushes immediately", () => {
        const app = makeApp();
        const pub = createAudioContextPublisher(app, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        const before = app.updateModelContext.mock.calls.length;
        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(50);
            pub.setRegionPreview(i, i + 1);
        }
        expect(app.updateModelContext.mock.calls.length).toBe(before);
        pub.setRegion(2, 5);
        expect(app.updateModelContext.mock.calls.length).toBe(before + 1);
        const last = app.updateModelContext.mock.calls[
            app.updateModelContext.mock.calls.length - 1
        ][0];
        const text = last.content[0].text as string;
        expect(text).toContain("region-start-seconds: 2.00");
        expect(text).toContain("region-end-seconds: 5.00");
    });

    it("clearRegion removes region keys from the next payload", () => {
        const app = makeApp();
        const pub = createAudioContextPublisher(app);
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        pub.setRegion(2, 5);
        pub.clearRegion();
        const last = app.updateModelContext.mock.calls[
            app.updateModelContext.mock.calls.length - 1
        ][0];
        const text = last.content[0].text as string;
        expect(text).not.toContain("region-start-seconds:");
        expect(text).not.toContain("region-end-seconds:");
    });

    it("routes updateModelContext rejection to logError and keeps working", async () => {
        const app = {
            updateModelContext: vi
                .fn()
                .mockRejectedValueOnce(new Error("nope"))
                .mockResolvedValue({}),
        };
        const logError = vi.fn();
        const pub = createAudioContextPublisher(app, { logError });
        pub.setFile("/x.flac");
        // let microtasks flush
        await Promise.resolve();
        await Promise.resolve();
        expect(logError).toHaveBeenCalledTimes(1);
        pub.setMetadata(META);
        expect(app.updateModelContext).toHaveBeenCalledTimes(2);
    });

    it("destroy cancels pending and ignores subsequent setters", () => {
        const app = makeApp();
        const pub = createAudioContextPublisher(app, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        vi.advanceTimersByTime(50);
        pub.setPosition(1, null); // schedules trailing
        const before = app.updateModelContext.mock.calls.length;
        pub.destroy();
        vi.advanceTimersByTime(5000);
        pub.setMetadata(META); // ignored
        pub.setRegion(1, 2); // ignored
        expect(app.updateModelContext.mock.calls.length).toBe(before);
    });

    it("skips publish when position rounds to the same 0.01 s with no samples", () => {
        const app = makeApp();
        const pub = createAudioContextPublisher(app, { minIntervalMs: 1000 });
        pub.setFile("/x.flac");
        pub.setMetadata(META);
        pub.setPlayback("paused");
        const before = app.updateModelContext.mock.calls.length;
        pub.setPosition(0, null);
        pub.setPosition(0.001, null);
        pub.setPosition(0.002, null);
        expect(app.updateModelContext.mock.calls.length).toBe(before);
    });
});
