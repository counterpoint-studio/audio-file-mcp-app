import { describe, it, expect } from "vitest";
import type { Loudness, LoudnessMode } from "../dsp/loudness";
import { LoudnessAnalyzer } from "./loudness";
import { TimeSeriesStore } from "./time-series";

type Call =
    | { type: "addFrames"; firstChannelLength: number; numChannels: number }
    | { type: "momentary"; result: number }
    | { type: "shortterm"; result: number };

type MockLoudness = Loudness & { calls: Call[]; disposed: boolean };

function mockLoudness(seq?: {
    momentary?: number[];
    shortterm?: number[];
    summary?: { global: number; range: number; truePeak: number; samplePeak: number };
}): MockLoudness {
    const calls: Call[] = [];
    let mi = 0;
    let si = 0;
    const m = seq?.momentary ?? [];
    const s = seq?.shortterm ?? [];
    const sum =
        seq?.summary ?? {
            global: -Infinity,
            range: 0,
            truePeak: -Infinity,
            samplePeak: -Infinity,
        };
    const mock: MockLoudness = {
        calls,
        disposed: false,
        addFrames(channels: Float32Array[]) {
            calls.push({
                type: "addFrames",
                firstChannelLength: channels[0].length,
                numChannels: channels.length,
            });
        },
        momentary() {
            const v = m[mi++] ?? -Infinity;
            calls.push({ type: "momentary", result: v });
            return v;
        },
        shortterm() {
            const v = s[si++] ?? -Infinity;
            calls.push({ type: "shortterm", result: v });
            return v;
        },
        global: () => sum.global,
        range: () => sum.range,
        truePeak: () => sum.truePeak,
        samplePeak: () => sum.samplePeak,
        dispose() {
            mock.disposed = true;
        },
    };
    return mock;
}

function chunk(samples: number, channels = 1, sampleRate = 44100) {
    return {
        sampleRate,
        channelData: Array.from(
            { length: channels },
            () => new Float32Array(samples),
        ),
        startSample: 0,
    };
}

describe("LoudnessAnalyzer (with mocked libebur128)", () => {
    it("constructs the Loudness with the init-supplied sample rate, channel count, and full mode flags", () => {
        let captured: { sampleRate: number; channels: number; mode: LoudnessMode } | null = null;
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, (sr, ch, mode) => {
            captured = { sampleRate: sr, channels: ch, mode };
            return mockLoudness();
        });
        a.init(44100, 2);
        expect(captured).toEqual({ sampleRate: 44100, channels: 2, mode: "M|S|I|LRA|TP|SP" });
    });

    it("calls addFrames once per fed chunk, with that chunk's channel arrays", () => {
        const mock = mockLoudness();
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 2);
        a.feed(chunk(100, 2));
        a.feed(chunk(250, 2));
        const addCalls = mock.calls.filter(
            (c) => c.type === "addFrames",
        ) as Extract<Call, { type: "addFrames" }>[];
        expect(addCalls).toHaveLength(2);
        expect(addCalls[0]).toEqual({
            type: "addFrames",
            firstChannelLength: 100,
            numChannels: 2,
        });
        expect(addCalls[1]).toEqual({
            type: "addFrames",
            firstChannelLength: 250,
            numChannels: 2,
        });
    });

    it("polls momentary and shortterm exactly once per samplesPerStep (4410 at 44.1 kHz)", () => {
        const mock = mockLoudness({
            momentary: [-30, -20, -10],
            shortterm: [-28, -22, -18],
        });
        const store = new TimeSeriesStore();
        for (let i = 0; i < 3; i++) store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(4410 * 3, 1));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(3);
        expect(mock.calls.filter((c) => c.type === "shortterm").length).toBe(3);
    });

    it("writes each polled value into the TimeSeriesStore at successive indices", () => {
        const mock = mockLoudness({
            momentary: [-30, -25, -20],
            shortterm: [-28, -23, -18],
        });
        const store = new TimeSeriesStore();
        for (let i = 0; i < 3; i++) store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(4410 * 3, 1));
        expect(store.momentary[0]).toBeCloseTo(-30);
        expect(store.momentary[1]).toBeCloseTo(-25);
        expect(store.momentary[2]).toBeCloseTo(-20);
        expect(store.shortTerm[0]).toBeCloseTo(-28);
        expect(store.shortTerm[1]).toBeCloseTo(-23);
        expect(store.shortTerm[2]).toBeCloseTo(-18);
    });

    it("fires a poll across chunk boundaries when cumulative samples cross a step", () => {
        const mock = mockLoudness({
            momentary: [-23, -22],
            shortterm: [-23, -22],
        });
        const store = new TimeSeriesStore();
        for (let i = 0; i < 2; i++) store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(1500, 1));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(0);
        a.feed(chunk(3000, 1));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(1);
        a.feed(chunk(4320, 1));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(2);
    });

    it("polls multiple times when a single chunk spans many samplesPerStep", () => {
        const mock = mockLoudness({
            momentary: [-30, -25, -20, -15, -10],
            shortterm: [-28, -23, -18, -13, -8],
        });
        const store = new TimeSeriesStore();
        for (let i = 0; i < 5; i++) store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(4410 * 5, 1));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(5);
        expect(store.momentary[4]).toBeCloseTo(-10);
    });

    it("stores -Infinity for silence/insufficient history (not NaN)", () => {
        const mock = mockLoudness({
            momentary: [-Infinity],
            shortterm: [-Infinity],
        });
        const store = new TimeSeriesStore();
        store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(4410, 1));
        expect(store.momentary[0]).toBe(-Infinity);
        expect(store.shortTerm[0]).toBe(-Infinity);
        expect(Number.isNaN(store.momentary[0])).toBe(false);
    });

    it("stores -Infinity when libebur128 returns NaN", () => {
        const mock = mockLoudness({ momentary: [NaN], shortterm: [NaN] });
        const store = new TimeSeriesStore();
        store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(4410, 1));
        expect(store.momentary[0]).toBe(-Infinity);
        expect(store.shortTerm[0]).toBe(-Infinity);
    });

    it("samplesPerStep tracks sample rate (48 kHz → 4800 samples per poll)", () => {
        const mock = mockLoudness({
            momentary: [-23, -23],
            shortterm: [-23, -23],
        });
        const store = new TimeSeriesStore();
        for (let i = 0; i < 2; i++) store.append(0, 0, 0);
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(48000, 1);
        a.feed(chunk(4800, 1, 48000));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(1);
        a.feed(chunk(4799, 1, 48000));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(1);
        a.feed(chunk(1, 1, 48000));
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(2);
    });

    it("summary() forwards the four loudness getters", () => {
        const mock = mockLoudness({
            summary: { global: -23.0, range: 7.5, truePeak: -0.5, samplePeak: -1.0 },
        });
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 2);
        a.finalize();
        expect(a.summary()).toEqual({
            integrated: -23.0,
            lra: 7.5,
            truePeak: -0.5,
            samplePeak: -1.0,
        });
    });

    it("summary() before init returns sentinel values without throwing", () => {
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mockLoudness());
        expect(a.summary()).toEqual({
            integrated: -Infinity,
            lra: 0,
            truePeak: -Infinity,
            samplePeak: -Infinity,
        });
    });

    it("finalize is safe to call with no pending samples", () => {
        const mock = mockLoudness();
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        expect(() => a.finalize()).not.toThrow();
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(0);
    });

    it("handles stereo channel arrays through to addFrames unchanged", () => {
        const mock = mockLoudness();
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 2);
        a.feed(chunk(100, 2));
        const last = mock.calls.find(
            (c) => c.type === "addFrames",
        ) as Extract<Call, { type: "addFrames" }>;
        expect(last.numChannels).toBe(2);
        expect(last.firstChannelLength).toBe(100);
    });

    it("dispose() forwards to the underlying Loudness and is idempotent", () => {
        const mock = mockLoudness();
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.dispose();
        expect(mock.disposed).toBe(true);
        expect(() => a.dispose()).not.toThrow();
    });

    it("ignores empty chunks", () => {
        const mock = mockLoudness();
        const store = new TimeSeriesStore();
        const a = new LoudnessAnalyzer(store, () => mock);
        a.init(44100, 1);
        a.feed(chunk(0, 1));
        expect(mock.calls.filter((c) => c.type === "addFrames").length).toBe(0);
        expect(mock.calls.filter((c) => c.type === "momentary").length).toBe(0);
    });
});
