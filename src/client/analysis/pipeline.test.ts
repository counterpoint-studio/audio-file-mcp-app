import { describe, it, expect } from "vitest";
import { AnalysisPipeline } from "./pipeline";
import type { Analyzer, AnalyzerChunk } from "./analyzer";

type Recorded = Analyzer & {
    initCalls: Array<{ sampleRate: number; numChannels: number }>;
    feedCalls: AnalyzerChunk[];
    finalizeCount: number;
};

function recordingAnalyzer(): Recorded {
    return {
        initCalls: [],
        feedCalls: [],
        finalizeCount: 0,
        init(sampleRate, numChannels) {
            this.initCalls.push({ sampleRate, numChannels });
        },
        feed(chunk) {
            this.feedCalls.push(chunk);
        },
        finalize() {
            this.finalizeCount++;
        },
    };
}

function chunk(samples: number, channels = 2, sampleRate = 44100) {
    return {
        sampleRate,
        channelData: Array.from(
            { length: channels },
            () => new Float32Array(samples),
        ),
    };
}

describe("AnalysisPipeline", () => {
    it("calls init exactly once, on the first feed, with first chunk's sampleRate and channel count", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.feed(chunk(100, 2, 48000));
        p.feed(chunk(100, 2, 48000));
        expect(a.initCalls).toEqual([{ sampleRate: 48000, numChannels: 2 }]);
    });

    it("dispatches each chunk to all analyzers in registration order", () => {
        const order: string[] = [];
        const make = (id: string): Analyzer => ({
            init() {},
            finalize() {},
            feed() {
                order.push(id);
            },
        });
        const p = new AnalysisPipeline([make("a"), make("b"), make("c")]);
        p.feed(chunk(50));
        p.feed(chunk(50));
        expect(order).toEqual(["a", "b", "c", "a", "b", "c"]);
    });

    it("advances startSample by the per-chunk sample count", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.feed(chunk(100));
        p.feed(chunk(250));
        p.feed(chunk(50));
        expect(a.feedCalls.map((c) => c.startSample)).toEqual([0, 100, 350]);
    });

    it("exposes total decoded samples via totalSamples", () => {
        const p = new AnalysisPipeline([]);
        p.feed(chunk(100));
        p.feed(chunk(250));
        expect(p.totalSamples).toBe(350);
    });

    it("calls finalize on every analyzer in order, exactly once", () => {
        const order: string[] = [];
        const make = (id: string): Analyzer => ({
            init() {},
            feed() {},
            finalize() {
                order.push(id);
            },
        });
        const p = new AnalysisPipeline([make("a"), make("b")]);
        p.feed(chunk(100));
        p.finalize();
        expect(order).toEqual(["a", "b"]);
    });

    it("finalize before any feed is a no-op (no init, no finalize calls)", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.finalize();
        expect(a.initCalls).toHaveLength(0);
        expect(a.finalizeCount).toBe(0);
    });

    it("handles an empty analyzer list without throwing", () => {
        const p = new AnalysisPipeline([]);
        expect(() => p.feed(chunk(100))).not.toThrow();
        expect(() => p.finalize()).not.toThrow();
        expect(p.totalSamples).toBe(100);
    });

    it("passes channel data through to analyzers unchanged (same Float32Array refs)", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        const c = chunk(64, 2);
        c.channelData[0][5] = 0.5;
        c.channelData[1][5] = -0.5;
        p.feed(c);
        expect(a.feedCalls[0].channelData[0]).toBe(c.channelData[0]);
        expect(a.feedCalls[0].channelData[1][5]).toBe(-0.5);
    });

    it("handles mono chunks (numChannels=1)", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.feed(chunk(100, 1));
        expect(a.initCalls[0].numChannels).toBe(1);
    });

    it("skips chunks with zero channels or zero frames", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.feed({ sampleRate: 44100, channelData: [] });
        p.feed({ sampleRate: 44100, channelData: [new Float32Array(0)] });
        expect(a.initCalls).toHaveLength(0);
        expect(a.feedCalls).toHaveLength(0);
        expect(p.totalSamples).toBe(0);
    });

    it("throws when a later chunk's channel count differs from the initial chunk", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.feed(chunk(100, 2));
        const monoSamples = new Float32Array(100);
        expect(() =>
            p.feed({ sampleRate: 44100, channelData: [monoSamples] }),
        ).toThrow(/channel count 1 differs from initial 2/);
    });

    it("throws when a later chunk supplies extra channels", () => {
        const a = recordingAnalyzer();
        const p = new AnalysisPipeline([a]);
        p.feed(chunk(50, 1));
        expect(() => p.feed(chunk(50, 3))).toThrow(
            /channel count 3 differs from initial 1/,
        );
    });
});
