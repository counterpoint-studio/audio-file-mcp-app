import { describe, it, expect } from "vitest";
import { FrameRouter, FFT_SIZE, HOP, type FrameConsumer } from "./frame-router";
import type { AnalyzerChunk } from "./analyzer";

type CapturedFrame = { frame: Float32Array; frameIndex: number; sampleRate: number };

function recordingConsumer(): FrameConsumer & { frames: CapturedFrame[] } {
    const frames: CapturedFrame[] = [];
    return {
        frames,
        onFrame(frame, frameIndex, sampleRate) {
            frames.push({ frame: new Float32Array(frame), frameIndex, sampleRate });
        },
    };
}

function chunk(samples: number[], sampleRate = 44100): AnalyzerChunk {
    return {
        sampleRate,
        channelData: [Float32Array.from(samples)],
        startSample: 0,
    };
}

function stereoChunk(left: number[], right: number[], sampleRate = 44100): AnalyzerChunk {
    return {
        sampleRate,
        channelData: [Float32Array.from(left), Float32Array.from(right)],
        startSample: 0,
    };
}

describe("FrameRouter", () => {
    it("emits no frames before FFT_SIZE samples have been buffered", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE - 1).fill(0)));
        expect(c.frames).toHaveLength(0);
    });

    it("emits frame 0 exactly when the buffer reaches FFT_SIZE", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE).fill(0)));
        expect(c.frames).toHaveLength(1);
        expect(c.frames[0].frameIndex).toBe(0);
        expect(c.frames[0].sampleRate).toBe(44100);
    });

    it("emits subsequent frames every HOP samples (50% overlap)", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE + HOP * 3).fill(0)));
        expect(c.frames.map(f => f.frameIndex)).toEqual([0, 1, 2, 3]);
    });

    it("emits raw (unwindowed) frames: constant-1 input produces all-1 frame", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE).fill(1)));
        expect(c.frames).toHaveLength(1);
        for (let i = 0; i < FFT_SIZE; i++) {
            expect(c.frames[0].frame[i]).toBe(1);
        }
    });

    it("downmixes stereo as (L + R) / 2: opposite-phase signals cancel to zero", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 2);
        r.feed(stereoChunk(
            new Array(FFT_SIZE).fill(1),
            new Array(FFT_SIZE).fill(-1),
        ));
        expect(c.frames).toHaveLength(1);
        for (const v of c.frames[0].frame) expect(v).toBe(0);
    });

    it("downmix handles unequal stereo correctly: L=0.6 R=0.4 → mono=0.5 (unwindowed)", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 2);
        r.feed(stereoChunk(
            new Array(FFT_SIZE).fill(0.6),
            new Array(FFT_SIZE).fill(0.4),
        ));
        for (let i = 0; i < FFT_SIZE; i++) {
            expect(c.frames[0].frame[i]).toBeCloseTo(0.5, 6);
        }
    });

    it("accumulates samples across multiple chunks into one frame", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(500).fill(1)));
        r.feed(chunk(new Array(1000).fill(1)));
        expect(c.frames).toHaveLength(0);
        r.feed(chunk(new Array(FFT_SIZE - 1500).fill(1)));
        expect(c.frames).toHaveLength(1);
        for (let i = 0; i < FFT_SIZE; i++) {
            expect(c.frames[0].frame[i]).toBe(1);
        }
    });

    it("emits multiple frames from a single large chunk", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE + HOP * 5).fill(0)));
        expect(c.frames.map(f => f.frameIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("preserves overlap: a unique marker sample lands in two consecutive frames at correctly-offset positions", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        const samples = new Array(FFT_SIZE + HOP).fill(0);
        const M = 1500;
        samples[M] = 7;
        r.feed(chunk(samples));
        expect(c.frames).toHaveLength(2);
        expect(c.frames[0].frame[M]).toBe(7);
        expect(c.frames[1].frame[M - HOP]).toBe(7);
        expect(c.frames[1].frame[M]).toBe(0);
    });

    it("delivers every frame to every registered consumer with identical contents", () => {
        const c1 = recordingConsumer();
        const c2 = recordingConsumer();
        const c3 = recordingConsumer();
        const r = new FrameRouter([c1, c2, c3]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE + HOP).fill(1)));
        expect(c1.frames).toHaveLength(2);
        expect(c2.frames).toHaveLength(2);
        expect(c3.frames).toHaveLength(2);
        for (let i = 0; i < FFT_SIZE; i++) {
            expect(c2.frames[0].frame[i]).toBe(c1.frames[0].frame[i]);
            expect(c3.frames[0].frame[i]).toBe(c1.frames[0].frame[i]);
        }
    });

    it("propagates sample rate from init through to onFrame", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(48000, 1);
        r.feed(chunk(new Array(FFT_SIZE).fill(0), 48000));
        expect(c.frames[0].sampleRate).toBe(48000);
    });

    it("frameIndex increments monotonically across multiple feed calls", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE).fill(0)));
        r.feed(chunk(new Array(HOP).fill(0)));
        r.feed(chunk(new Array(HOP).fill(0)));
        expect(c.frames.map(f => f.frameIndex)).toEqual([0, 1, 2]);
    });

    it("handles extreme fragmentation (one sample per chunk)", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        for (let i = 0; i < FFT_SIZE + HOP; i++) r.feed(chunk([1]));
        expect(c.frames.map(f => f.frameIndex)).toEqual([0, 1]);
    });

    it("does not emit a partial trailing frame on finalize (zero-padding intentionally skipped)", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        r.feed(chunk(new Array(FFT_SIZE - 100).fill(1)));
        r.finalize();
        expect(c.frames).toHaveLength(0);
    });

    it("finalize is safe to call before any feed", () => {
        const c = recordingConsumer();
        const r = new FrameRouter([c]);
        r.init(44100, 1);
        expect(() => r.finalize()).not.toThrow();
        expect(c.frames).toHaveLength(0);
    });

    it("works with no consumers (no-op fanout)", () => {
        const r = new FrameRouter([]);
        r.init(44100, 1);
        expect(() => r.feed(chunk(new Array(FFT_SIZE).fill(0)))).not.toThrow();
    });
});
