import { createFft, type Fft } from "../dsp/fft";
import { makeHann, multiplyInto } from "../dsp/windows";
import type { Analyzer, AnalyzerChunk } from "./analyzer";
import { FFT_SIZE, HOP, type FrameConsumer } from "./frame-router";

export const BAND_EDGES_HZ = {
    lowMax: 250,
    midMax: 4000,
} as const;

export type BandEnergy = { low: number; mid: number; high: number };

export class WaveformBandEnergyAnalyzer implements FrameConsumer, Analyzer {
    private fft: Fft | null = null;
    private hann: Float32Array | null = null;
    private windowed = new Float32Array(FFT_SIZE);
    private buf: Float32Array;
    private count = 0;
    private sampleRate = 0;
    private binBounds: { loEnd: number; midEnd: number; hiEnd: number } | null = null;

    constructor(initialFrames = 60 * 43) {
        this.buf = new Float32Array(Math.max(3, initialFrames) * 3);
    }

    init(sampleRate: number): void {
        this.sampleRate = sampleRate;
        this.count = 0;
        if (!this.fft) this.fft = createFft(FFT_SIZE);
        if (!this.hann) this.hann = makeHann(FFT_SIZE);
        this.binBounds = this.computeBinBounds(sampleRate);
    }

    feed(_chunk: AnalyzerChunk): void {
        // Driven by FrameRouter via onFrame.
    }

    onFrame(frame: Float32Array, _frameIndex: number, sampleRate: number): void {
        if (sampleRate !== this.sampleRate) {
            this.sampleRate = sampleRate;
            this.binBounds = this.computeBinBounds(sampleRate);
        }
        const fft = this.fft;
        const bb = this.binBounds;
        const hann = this.hann;
        if (!fft || !bb || !hann) return;
        multiplyInto(frame, hann, this.windowed);
        const mags = fft.magnitudes(this.windowed);
        let low = 0,
            mid = 0,
            high = 0;
        for (let k = 1; k < bb.loEnd; k++) low += mags[k] * mags[k];
        for (let k = bb.loEnd; k < bb.midEnd; k++) mid += mags[k] * mags[k];
        for (let k = bb.midEnd; k < bb.hiEnd; k++) high += mags[k] * mags[k];
        this.append(low, mid, high);
    }

    finalize(): void {}

    /** Aggregate band energies overlapping [tStart, tEnd] in seconds (linear average). */
    queryRange(tStart: number, tEnd: number): BandEnergy {
        if (this.count === 0 || this.sampleRate <= 0) {
            return { low: 0, mid: 0, high: 0 };
        }
        const framePeriod = HOP / this.sampleRate;
        const i0 = Math.max(0, Math.floor(tStart / framePeriod));
        let i1 = Math.min(this.count, Math.ceil(tEnd / framePeriod));
        if (i1 <= i0) i1 = Math.min(this.count, i0 + 1);
        let low = 0,
            mid = 0,
            high = 0;
        for (let i = i0; i < i1; i++) {
            low += this.buf[i * 3];
            mid += this.buf[i * 3 + 1];
            high += this.buf[i * 3 + 2];
        }
        const n = i1 - i0;
        return n > 0
            ? { low: low / n, mid: mid / n, high: high / n }
            : { low: 0, mid: 0, high: 0 };
    }

    get frameCount(): number {
        return this.count;
    }

    private append(low: number, mid: number, high: number): void {
        if ((this.count + 1) * 3 > this.buf.length) {
            const next = new Float32Array(this.buf.length * 2);
            next.set(this.buf);
            this.buf = next;
        }
        this.buf[this.count * 3] = low;
        this.buf[this.count * 3 + 1] = mid;
        this.buf[this.count * 3 + 2] = high;
        this.count++;
    }

    private computeBinBounds(sampleRate: number) {
        const hzPerBin = sampleRate / 2 / (FFT_SIZE / 2 - 1);
        const clamp = (k: number) => Math.max(0, Math.min(FFT_SIZE / 2, k));
        return {
            loEnd: clamp(Math.round(BAND_EDGES_HZ.lowMax / hzPerBin)),
            midEnd: clamp(Math.round(BAND_EDGES_HZ.midMax / hzPerBin)),
            hiEnd: FFT_SIZE / 2,
        };
    }
}
