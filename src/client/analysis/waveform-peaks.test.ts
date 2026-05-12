import { describe, it, expect } from "vitest";
import { WaveformPeaksAnalyzer } from "./waveform-peaks";
import type { AnalyzerChunk } from "./analyzer";

function feedSamples(
    a: WaveformPeaksAnalyzer,
    channels: number[][],
    sampleRate = 44100,
    startSample = 0,
): void {
    const chunk: AnalyzerChunk = {
        sampleRate,
        channelData: channels.map((s) => Float32Array.from(s)),
        startSample,
    };
    a.feed(chunk);
}

describe("WaveformPeaksAnalyzer (data path, no canvas)", () => {
    it("starts with zero peaks", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        expect(a.peakCount).toBe(0);
    });

    it("produces exactly one bucket when fed samplesPerBucket samples (round(44100/200) = 221)", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        feedSamples(a, [new Array(221).fill(0.5)]);
        expect(a.peakCount).toBe(1);
        expect(a.minAt(0)).toBeCloseTo(0.5);
        expect(a.maxAt(0)).toBeCloseTo(0.5);
    });

    it("captures min and max within a bucket from alternating samples", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        const samples = new Array(221)
            .fill(0)
            .map((_, i) => (i % 2 === 0 ? 0.7 : -0.4));
        feedSamples(a, [samples]);
        expect(a.maxAt(0)).toBeCloseTo(0.7);
        expect(a.minAt(0)).toBeCloseTo(-0.4);
    });

    it("collapses stereo: min across channels for min, max across channels for max", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 2);
        feedSamples(a, [
            new Array(221).fill(0.6),
            new Array(221).fill(-0.8),
        ]);
        expect(a.maxAt(0)).toBeCloseTo(0.6);
        expect(a.minAt(0)).toBeCloseTo(-0.8);
    });

    it("does not emit a partial bucket until finalize is called", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        feedSamples(a, [new Array(100).fill(0.3)]);
        expect(a.peakCount).toBe(0);
        a.finalize();
        expect(a.peakCount).toBe(1);
        expect(a.maxAt(0)).toBeCloseTo(0.3);
    });

    it("accumulates partial chunks into the same bucket across feeds", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        feedSamples(a, [new Array(100).fill(0.2)], 44100, 0);
        expect(a.peakCount).toBe(0);
        feedSamples(a, [new Array(121).fill(-0.3)], 44100, 100);
        expect(a.peakCount).toBe(1);
        expect(a.maxAt(0)).toBeCloseTo(0.2);
        expect(a.minAt(0)).toBeCloseTo(-0.3);
    });

    it("produces multiple buckets from a chunk spanning many samplesPerBucket", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        const samples = [
            ...new Array(221).fill(0.4),
            ...new Array(221).fill(0.8),
        ];
        feedSamples(a, [samples]);
        expect(a.peakCount).toBe(2);
        expect(a.maxAt(0)).toBeCloseTo(0.4);
        expect(a.maxAt(1)).toBeCloseTo(0.8);
    });

    it("handles empty chunks gracefully", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        feedSamples(a, [[]]);
        expect(a.peakCount).toBe(0);
        a.finalize();
        expect(a.peakCount).toBe(0);
    });

    it("derives samplesPerBucket from sample rate (48 kHz → 240 samples)", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(48000, 1);
        feedSamples(a, [new Array(240).fill(0.9)], 48000);
        expect(a.peakCount).toBe(1);
        expect(a.maxAt(0)).toBeCloseTo(0.9);
    });

    it("does not throw when no canvas is set (data-only mode)", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        expect(() => {
            feedSamples(a, [new Array(220).fill(0.5)]);
            a.finalize();
        }).not.toThrow();
        expect(a.peakCount).toBe(1);
    });

    it("handles silence (all-zero samples) without emitting NaN peaks", () => {
        const a = new WaveformPeaksAnalyzer();
        a.init(44100, 1);
        feedSamples(a, [new Array(221).fill(0)]);
        expect(a.peakCount).toBe(1);
        expect(a.minAt(0)).toBe(0);
        expect(a.maxAt(0)).toBe(0);
    });
});
