import { describe, it, expect } from "vitest";
import { TimeSeriesStore } from "./time-series";
import { SampleStatsAnalyzer } from "./sample-stats";

function feed(
    a: SampleStatsAnalyzer,
    channels: number[][],
    sampleRate = 44100,
): void {
    a.feed({
        sampleRate,
        channelData: channels.map((s) => Float32Array.from(s)),
        startSample: 0,
    });
}

describe("SampleStatsAnalyzer", () => {
    it("does not flush a step until samplesPerStep samples have been fed", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        feed(a, [new Array(4000).fill(0.5)]);
        expect(store.count).toBe(0);
        feed(a, [new Array(410).fill(0.5)]);
        expect(store.count).toBe(1);
    });

    it("records sample peak as max |x| within the step (mono)", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        const samples = new Array(4410).fill(0.3);
        samples[100] = -0.8;
        feed(a, [samples]);
        expect(store.samplePeak[0]).toBeCloseTo(0.8);
    });

    it("records RMS = mean amplitude for a constant signal", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        feed(a, [new Array(4410).fill(0.5)]);
        expect(store.rms[0]).toBeCloseTo(0.5);
    });

    it("records RMS ≈ 1/√2 for a full-scale sine and sample peak ≈ 1.0", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        const samples: number[] = [];
        for (let i = 0; i < 4410; i++) {
            samples.push(Math.sin((2 * Math.PI * 1000 * i) / 44100));
        }
        feed(a, [samples]);
        expect(store.rms[0]).toBeCloseTo(Math.SQRT1_2, 2);
        expect(store.samplePeak[0]).toBeCloseTo(1.0, 2);
    });

    it("records peak ≈ 0.1 and RMS ≈ 0.1/√2 for a -20 dBFS sine (manual-check parity)", () => {
        // -20 dBFS sine: amplitude 10^(-20/20) = 0.1. Peak should equal 0.1
        // (so 20·log10(0.1) = -20 dB), RMS = 0.1/√2 (so peak − rms = 3 dB).
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        const samples: number[] = [];
        const amp = 0.1;
        for (let i = 0; i < 4410; i++) {
            samples.push(amp * Math.sin((2 * Math.PI * 1000 * i) / 44100));
        }
        feed(a, [samples]);
        expect(store.samplePeak[0]).toBeCloseTo(0.1, 3);
        expect(store.rms[0]).toBeCloseTo(0.1 * Math.SQRT1_2, 3);
        // Sanity: peak/rms in dB → ≈ 3 dB (sine crest).
        const peakDb = 20 * Math.log10(store.samplePeak[0]);
        const rmsDb = 20 * Math.log10(store.rms[0]);
        expect(peakDb).toBeCloseTo(-20, 1);
        expect(peakDb - rmsDb).toBeCloseTo(3.0, 1);
    });

    it("counts clipping samples (|x| >= 0.99999) per channel-sample", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        const samples = new Array(4410).fill(0.5);
        for (let i = 0; i < 10; i++) samples[i] = 1.0;
        feed(a, [samples]);
        expect(store.clipping[0]).toBe(10);
    });

    it("collapses stereo: sample peak = max over channels, RMS = mean-of-squares-across-channels", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 2);
        feed(a, [
            new Array(4410).fill(0.5),
            new Array(4410).fill(0.0),
        ]);
        expect(store.samplePeak[0]).toBeCloseTo(0.5);
        expect(store.rms[0]).toBeCloseTo(Math.sqrt(0.125), 4);
    });

    it("accumulates across multiple chunks into a single step", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        feed(a, [new Array(1000).fill(0.2)]);
        feed(a, [new Array(2000).fill(0.5)]);
        feed(a, [new Array(1410).fill(0.3)]);
        expect(store.count).toBe(1);
        expect(store.samplePeak[0]).toBeCloseTo(0.5);
    });

    it("produces multiple steps when a chunk spans many samplesPerStep", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        const samples = [
            ...new Array(4410).fill(0.2),
            ...new Array(4410).fill(0.8),
        ];
        feed(a, [samples]);
        expect(store.count).toBe(2);
        expect(store.samplePeak[0]).toBeCloseTo(0.2);
        expect(store.samplePeak[1]).toBeCloseTo(0.8);
    });

    it("flushes a partial trailing window on finalize", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        feed(a, [new Array(2000).fill(0.4)]);
        expect(store.count).toBe(0);
        a.finalize();
        expect(store.count).toBe(1);
        expect(store.samplePeak[0]).toBeCloseTo(0.4);
        expect(store.rms[0]).toBeCloseTo(0.4);
    });

    it("does not emit a step on finalize when no samples are pending", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        a.finalize();
        expect(store.count).toBe(0);
    });

    it("derives samplesPerStep from sample rate (48 kHz → 4800)", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(48000, 1);
        feed(a, [new Array(4800).fill(0.7)], 48000);
        expect(store.count).toBe(1);
        expect(store.samplePeak[0]).toBeCloseTo(0.7);
    });

    it("handles silence without emitting NaN", () => {
        const store = new TimeSeriesStore();
        const a = new SampleStatsAnalyzer(store);
        a.init(44100, 1);
        feed(a, [new Array(4410).fill(0)]);
        expect(store.samplePeak[0]).toBe(0);
        expect(store.rms[0]).toBe(0);
        expect(store.clipping[0]).toBe(0);
    });
});
