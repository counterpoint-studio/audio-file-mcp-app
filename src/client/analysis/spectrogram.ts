import { createFft, type Fft } from "../dsp/fft";
import type { Analyzer, AnalyzerChunk } from "./analyzer";
import { FFT_SIZE, HOP, type FrameConsumer } from "./frame-router";

const MAX_COLS = 4000;
const NUM_BINS = 256;
const REDRAW_INTERVAL_MS = 50;
const MIN_HZ = 20;
const FLOOR_DB = -100;
const CEIL_DB = 0;

function makeColorLut(): Uint8ClampedArray {
    const lut = new Uint8ClampedArray(256 * 4);
    // Silence → near-surface (#fafafa-ish), peak → near-black (#141414).
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        const v = Math.round(250 - 230 * t);
        lut[i * 4 + 0] = v;
        lut[i * 4 + 1] = v;
        lut[i * 4 + 2] = v;
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

const COLOR_LUT = makeColorLut();

function buildLogBinEdges(
    rawBinCount: number,
    sampleRate: number,
): Uint16Array {
    const nyquist = sampleRate / 2;
    const minHz = Math.max(MIN_HZ, sampleRate / FFT_SIZE);
    const maxHz = nyquist;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    const edges = new Uint16Array(NUM_BINS + 1);
    const hzPerBin = nyquist / (rawBinCount - 1);
    for (let i = 0; i <= NUM_BINS; i++) {
        const t = i / NUM_BINS;
        const hz = Math.exp(logMin + (logMax - logMin) * t);
        const raw = Math.round(hz / hzPerBin);
        edges[i] = Math.max(0, Math.min(rawBinCount - 1, raw));
    }
    return edges;
}

export class SpectrogramAnalyzer implements FrameConsumer, Analyzer {
    private fft: Fft | null = null;
    private grid = new Float32Array(MAX_COLS * NUM_BINS);
    private currentCol = 0;
    private framesPerCol = 1;
    private framesInCol = 0;
    private durationSeconds: number | null = null;
    private sampleRate = 0;
    private logBinEdges: Uint16Array | null = null;
    private colMags = new Float32Array(NUM_BINS);

    private canvas: OffscreenCanvas | null = null;
    private ctx: OffscreenCanvasRenderingContext2D | null = null;
    private cssWidth = 0;
    private cssHeight = 0;
    private dpr = 1;
    private lastRedrawAt = 0;

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

    setDuration(seconds: number, sampleRate?: number): void {
        this.durationSeconds = seconds;
        const sr = sampleRate ?? this.sampleRate;
        if (sr > 0) {
            const totalFrames = Math.ceil((seconds * sr) / HOP);
            this.framesPerCol = Math.max(1, Math.ceil(totalFrames / MAX_COLS));
        }
        this.redraw();
    }

    init(sampleRate: number): void {
        this.sampleRate = sampleRate;
        this.grid.fill(0);
        this.currentCol = 0;
        this.framesInCol = 0;
        this.logBinEdges = buildLogBinEdges(FFT_SIZE / 2, sampleRate);
        if (!this.fft) this.fft = createFft(FFT_SIZE);
        if (this.durationSeconds !== null) {
            const totalFrames = Math.ceil((this.durationSeconds * sampleRate) / HOP);
            this.framesPerCol = Math.max(1, Math.ceil(totalFrames / MAX_COLS));
        }
    }

    feed(_chunk: AnalyzerChunk): void {
        // Driven by FrameRouter via onFrame.
    }

    onFrame(window: Float32Array, _frameIndex: number, sampleRate: number): void {
        const fft = this.fft;
        const edges = this.logBinEdges;
        if (!fft || !edges) return;
        if (sampleRate !== this.sampleRate) {
            this.sampleRate = sampleRate;
            this.logBinEdges = buildLogBinEdges(FFT_SIZE / 2, sampleRate);
        }
        const mags = fft.magnitudes(window);
        const colMags = this.colMags;
        const useEdges = this.logBinEdges!;
        for (let i = 0; i < NUM_BINS; i++) {
            const lo = useEdges[i];
            const hi = Math.max(lo + 1, useEdges[i + 1]);
            let m = 0;
            for (let k = lo; k < hi; k++) {
                const v = mags[k];
                if (v > m) m = v;
            }
            colMags[i] = m;
        }
        const off = this.currentCol * NUM_BINS;
        for (let i = 0; i < NUM_BINS; i++) {
            if (colMags[i] > this.grid[off + i]) this.grid[off + i] = colMags[i];
        }
        this.framesInCol++;
        if (this.framesInCol >= this.framesPerCol && this.currentCol < MAX_COLS - 1) {
            this.currentCol++;
            this.framesInCol = 0;
        }
        this.maybeRedraw();
    }

    finalize(): void {
        this.redraw();
    }

    dispose(): void {
        if (this.fft) {
            this.fft.dispose();
            this.fft = null;
        }
    }

    private applySize(w: number, h: number, ratio: number): void {
        if (!this.canvas) return;
        this.cssWidth = w;
        this.cssHeight = h;
        this.dpr = ratio;
        this.canvas.width = Math.max(1, Math.round(w * ratio));
        this.canvas.height = Math.max(1, Math.round(h * ratio));
        this.ctx = this.canvas.getContext("2d");
    }

    private maybeRedraw(): void {
        if (!this.ctx) return;
        const now = performance.now();
        if (now - this.lastRedrawAt < REDRAW_INTERVAL_MS) return;
        this.lastRedrawAt = now;
        this.redraw();
    }

    private redraw(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
        const decodedCols =
            this.currentCol + (this.framesInCol > 0 ? 1 : 0);
        if (decodedCols <= 0) {
            ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
            return;
        }

        const totalCols = this.totalColsForLayout(decodedCols);
        const cssDecodedW = (decodedCols / totalCols) * this.cssWidth;

        const cssH = this.cssHeight;
        const offsetW = Math.max(1, Math.round(cssDecodedW * this.dpr));
        const offsetH = Math.max(1, Math.round(cssH * this.dpr));

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.cssWidth * this.dpr, this.cssHeight * this.dpr);
        ctx.restore();

        const imgData = new ImageData(decodedCols, NUM_BINS);
        this.renderInto(imgData.data, decodedCols);

        const tmp = new OffscreenCanvas(decodedCols, NUM_BINS);
        const tctx = tmp.getContext("2d");
        if (!tctx) return;
        tctx.putImageData(imgData, 0, 0);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "low";
        ctx.drawImage(tmp, 0, 0, decodedCols, NUM_BINS, 0, 0, offsetW, offsetH);
        ctx.restore();
    }

    private totalColsForLayout(decodedCols: number): number {
        if (this.durationSeconds === null || this.sampleRate <= 0) {
            return decodedCols;
        }
        const totalFrames = Math.ceil((this.durationSeconds * this.sampleRate) / HOP);
        const totalCols = Math.min(MAX_COLS, Math.ceil(totalFrames / this.framesPerCol));
        return Math.max(decodedCols, totalCols);
    }

    private renderInto(buf: Uint8ClampedArray, decodedCols: number): void {
        const range = CEIL_DB - FLOOR_DB;
        const lut = COLOR_LUT;
        for (let col = 0; col < decodedCols; col++) {
            const srcOff = col * NUM_BINS;
            for (let b = 0; b < NUM_BINS; b++) {
                const mag = this.grid[srcOff + b];
                let db = mag > 0 ? 20 * Math.log10(mag) : FLOOR_DB;
                if (db < FLOOR_DB) db = FLOOR_DB;
                if (db > CEIL_DB) db = CEIL_DB;
                const t = (db - FLOOR_DB) / range;
                const li = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
                const y = NUM_BINS - 1 - b;
                const dstOff = (y * decodedCols + col) * 4;
                buf[dstOff + 0] = lut[li + 0];
                buf[dstOff + 1] = lut[li + 1];
                buf[dstOff + 2] = lut[li + 2];
                buf[dstOff + 3] = lut[li + 3];
            }
        }
    }
}
