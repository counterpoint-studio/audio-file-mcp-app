import { describe, it, expect, vi } from "vitest";
import { decodeWithMediabunny, type DecodeChunk } from "./mediabunny-decode";
import type { AudioSample, InputAudioTrack, Source } from "mediabunny";

function fakeSource(): Source {
    return {} as unknown as Source;
}

type SampleCopyOptions = {
    planeIndex: number;
    format?: string;
    frameOffset?: number;
    frameCount?: number;
};

function makeSample(
    numCh: number,
    sampleRate: number,
    frames: number,
    fill: number,
): AudioSample {
    const planes: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) {
        const arr = new Float32Array(frames);
        arr.fill(fill + c * 0.1);
        planes.push(arr);
    }
    const closed = { v: false };
    const sample = {
        numberOfChannels: numCh,
        numberOfFrames: frames,
        sampleRate,
        duration: frames / sampleRate,
        timestamp: 0,
        copyTo(destination: ArrayBufferView, options: SampleCopyOptions) {
            const src = planes[options.planeIndex];
            (destination as Float32Array).set(src);
        },
        close() {
            closed.v = true;
        },
    };
    Object.defineProperty(sample, "_closed", { get: () => closed.v });
    return sample as unknown as AudioSample;
}

function fakeTrack(): InputAudioTrack {
    return {} as unknown as InputAudioTrack;
}

function fakeSink(samples: AudioSample[]) {
    return {
        samples(): AsyncIterable<AudioSample> {
            let i = 0;
            return {
                [Symbol.asyncIterator]() {
                    return {
                        next: async () => {
                            if (i < samples.length) {
                                return { value: samples[i++], done: false };
                            }
                            return {
                                value: undefined as unknown as AudioSample,
                                done: true,
                            };
                        },
                    };
                },
            };
        },
    };
}

describe("decodeWithMediabunny", () => {
    it("feeds every sink sample to the onChunk callback in order", async () => {
        const samples = [
            makeSample(2, 48000, 1024, 0.1),
            makeSample(2, 48000, 1024, 0.2),
            makeSample(2, 48000, 512, 0.3),
        ];
        const dispose = vi.fn();
        // Snapshot per-call: channelData is pooled and reused across iterations.
        type Snap = {
            sampleRate: number;
            numCh: number;
            firstSamples: number[];
            firstChannelLength: number;
        };
        const snaps: Snap[] = [];
        await decodeWithMediabunny(fakeSource(), {
            onChunk: (c) =>
                snaps.push({
                    sampleRate: c.sampleRate,
                    numCh: c.channelData.length,
                    firstSamples: c.channelData.map((arr) => arr[0]),
                    firstChannelLength: c.channelData[0].length,
                }),
            yieldEveryMs: 1_000_000, // suppress yield in test
            inputFactory: () => ({
                getPrimaryAudioTrack: async () => fakeTrack(),
                dispose,
            }),
            sinkFactory: () => fakeSink(samples),
        });
        expect(snaps).toHaveLength(3);
        expect(snaps[0].sampleRate).toBe(48000);
        expect(snaps[0].numCh).toBe(2);
        expect(snaps[0].firstSamples[0]).toBeCloseTo(0.1, 5);
        expect(snaps[0].firstSamples[1]).toBeCloseTo(0.2, 5); // second plane = fill + 0.1
        expect(snaps[1].firstSamples[0]).toBeCloseTo(0.2, 5);
        expect(snaps[2].firstChannelLength).toBe(512);
        expect(dispose).toHaveBeenCalled();
        for (const s of samples) {
            expect((s as unknown as { _closed: boolean })._closed).toBe(true);
        }
    });

    it("reuses pooled channel buffers across successive samples", async () => {
        const samples = [
            makeSample(2, 48000, 1024, 0.1),
            makeSample(2, 48000, 1024, 0.2),
        ];
        const refs: Float32Array[][] = [];
        await decodeWithMediabunny(fakeSource(), {
            onChunk: (c) => refs.push([...c.channelData]),
            yieldEveryMs: 1_000_000,
            inputFactory: () => ({
                getPrimaryAudioTrack: async () => fakeTrack(),
                dispose: vi.fn(),
            }),
            sinkFactory: () => fakeSink(samples),
        });
        expect(refs).toHaveLength(2);
        // Same backing Float32Array is handed back to subsequent feeds.
        expect(refs[1][0]).toBe(refs[0][0]);
        expect(refs[1][1]).toBe(refs[0][1]);
    });

    it("aborts iteration when isAborted returns true", async () => {
        const samples = [
            makeSample(1, 44100, 256, 0.0),
            makeSample(1, 44100, 256, 0.5),
        ];
        const dispose = vi.fn();
        let aborted = false;
        const chunks: DecodeChunk[] = [];
        await decodeWithMediabunny(fakeSource(), {
            onChunk: (c) => {
                chunks.push(c);
                aborted = true;
            },
            isAborted: () => aborted,
            yieldEveryMs: 1_000_000,
            inputFactory: () => ({
                getPrimaryAudioTrack: async () => fakeTrack(),
                dispose,
            }),
            sinkFactory: () => fakeSink(samples),
        });
        expect(chunks).toHaveLength(1);
        expect(dispose).toHaveBeenCalled();
    });

    it("throws and disposes when there is no audio track", async () => {
        const dispose = vi.fn();
        await expect(
            decodeWithMediabunny(fakeSource(), {
                onChunk: () => {},
                inputFactory: () => ({
                    getPrimaryAudioTrack: async () => null,
                    dispose,
                }),
                sinkFactory: () => fakeSink([]),
            }),
        ).rejects.toThrow(/no audio track/);
        expect(dispose).toHaveBeenCalled();
    });
});
