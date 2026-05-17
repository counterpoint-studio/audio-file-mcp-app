import type { Analyzer, AnalyzerChunk } from "./analyzer";
import {
    bandEnergyToFillStyle,
    waveformPalette,
    type Theme,
    type WaveformPalette,
} from "./band-shading";
import { GrowablePeaks } from "./growable-peaks";
import type { WaveformBandEnergyAnalyzer } from "./waveform-band-energy";

const PEAKS_PER_SECOND = 200;
const REDRAW_INTERVAL_MS = 100;

export class WaveformPeaksAnalyzer implements Analyzer {
    private peaks = new GrowablePeaks(60 * PEAKS_PER_SECOND);
    private samplesPerBucket = 0;
    private bucketSampleCount = 0;
    private bucketMin = Infinity;
    private bucketMax = -Infinity;
    private canvas: OffscreenCanvas | null = null;
    private ctx: OffscreenCanvasRenderingContext2D | null = null;
    private cssWidth = 0;
    private cssHeight = 0;
    private durationSeconds: number | null = null;
    private lastRedrawAt = 0;
    private palette: WaveformPalette = waveformPalette("light");

    constructor(private bandEnergy?: WaveformBandEnergyAnalyzer) {}

    setTheme(theme: Theme): void {
        const next = waveformPalette(theme);
        if (next === this.palette) return;
        this.palette = next;
        this.redraw();
    }

    get peakCount(): number {
        return this.peaks.count;
    }

    minAt(i: number): number {
        return this.peaks.minAt(i);
    }

    maxAt(i: number): number {
        return this.peaks.maxAt(i);
    }

    setCanvas(
        canvas: OffscreenCanvas,
        cssWidth: number,
        cssHeight: number,
        dpr: number,
    ): void {
        this.canvas = canvas;
        this.applySize(cssWidth, cssHeight, dpr);
        this.redraw();
    }

    resize(cssWidth: number, cssHeight: number, dpr: number): void {
        if (!this.canvas) return;
        this.applySize(cssWidth, cssHeight, dpr);
        this.redraw();
    }

    setDuration(seconds: number): void {
        this.durationSeconds = seconds;
        this.redraw();
    }

    init(sampleRate: number): void {
        this.samplesPerBucket = Math.max(
            1,
            Math.round(sampleRate / PEAKS_PER_SECOND),
        );
    }

    feed(chunk: AnalyzerChunk): void {
        const channels = chunk.channelData;
        const numChannels = channels.length;
        if (numChannels === 0) return;
        const sampleCount = channels[0].length;
        if (sampleCount === 0) return;
        for (let i = 0; i < sampleCount; i++) {
            let mn = Infinity;
            let mx = -Infinity;
            for (let c = 0; c < numChannels; c++) {
                const v = channels[c][i];
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            if (mn < this.bucketMin) this.bucketMin = mn;
            if (mx > this.bucketMax) this.bucketMax = mx;
            this.bucketSampleCount++;
            if (this.bucketSampleCount >= this.samplesPerBucket) {
                this.peaks.append(this.bucketMin, this.bucketMax);
                this.bucketSampleCount = 0;
                this.bucketMin = Infinity;
                this.bucketMax = -Infinity;
            }
        }
        this.maybeRedraw();
    }

    finalize(): void {
        if (this.bucketSampleCount > 0) {
            this.peaks.append(this.bucketMin, this.bucketMax);
            this.bucketSampleCount = 0;
            this.bucketMin = Infinity;
            this.bucketMax = -Infinity;
        }
        this.redraw();
    }

    private applySize(w: number, h: number, ratio: number): void {
        if (!this.canvas) return;
        this.cssWidth = w;
        this.cssHeight = h;
        this.canvas.width = Math.max(1, Math.round(w * ratio));
        this.canvas.height = Math.max(1, Math.round(h * ratio));
        this.ctx = this.canvas.getContext("2d");
        this.ctx?.scale(ratio, ratio);
    }

    private canDraw(): boolean {
        return (
            this.ctx !== null &&
            this.durationSeconds !== null &&
            this.peaks.count > 0 &&
            this.cssWidth > 0 &&
            this.cssHeight > 0
        );
    }

    private redraw(): void {
        if (!this.ctx) return;
        if (this.canDraw()) this.drawWaveform();
        else this.drawPlaceholder();
    }

    private maybeRedraw(): void {
        if (!this.ctx) return;
        const now = performance.now();
        if (now - this.lastRedrawAt >= REDRAW_INTERVAL_MS) {
            this.lastRedrawAt = now;
            if (this.canDraw()) this.drawWaveform();
        }
    }

    private drawPlaceholder(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        ctx.strokeStyle = this.palette.placeholder;
        ctx.beginPath();
        ctx.moveTo(0, this.cssHeight / 2);
        ctx.lineTo(this.cssWidth, this.cssHeight / 2);
        ctx.stroke();
    }

    private drawWaveform(): void {
        const ctx = this.ctx;
        if (!ctx || this.durationSeconds === null) return;
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
        const decodedBuckets = this.peaks.count;
        if (decodedBuckets === 0) return;

        const totalBuckets = Math.max(
            1,
            Math.round(this.durationSeconds * PEAKS_PER_SECOND),
        );
        // Map buckets → columns against the *full timeline*, not the
        // currently-decoded prefix. Otherwise the grouping reshuffles on every
        // redraw and the waveform visibly shimmers as more chunks arrive.
        const bucketsPerColumn = totalBuckets / this.cssWidth;
        const decodedColumns = Math.min(
            this.cssWidth,
            Math.floor(decodedBuckets / bucketsPerColumn),
        );
        if (decodedColumns <= 0) return;
        const cy = this.cssHeight / 2;
        const halfH = this.cssHeight / 2 - 1;

        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        const totalSeconds = this.durationSeconds;
        const cssWidth = this.cssWidth;
        for (let col = 0; col < decodedColumns; col++) {
            const start = Math.floor(col * bucketsPerColumn);
            const end = Math.min(
                decodedBuckets,
                Math.floor((col + 1) * bucketsPerColumn),
            );
            let mn = Infinity;
            let mx = -Infinity;
            for (let b = start; b < end; b++) {
                const bmn = this.peaks.minAt(b);
                const bmx = this.peaks.maxAt(b);
                if (bmn < mn) mn = bmn;
                if (bmx > mx) mx = bmx;
            }
            if (mn === Infinity) continue;
            const yTop = cy - mx * halfH;
            const yBot = cy - mn * halfH;
            const h = Math.max(1, yBot - yTop);

            if (this.bandEnergy) {
                const t0 = (col / cssWidth) * totalSeconds;
                const t1 = ((col + 1) / cssWidth) * totalSeconds;
                ctx.fillStyle = bandEnergyToFillStyle(
                    this.bandEnergy.queryRange(t0, t1),
                    this.palette,
                );
            } else {
                ctx.fillStyle = this.palette.fallback;
            }
            ctx.fillRect(col, yTop, 1, h);
        }
    }
}
