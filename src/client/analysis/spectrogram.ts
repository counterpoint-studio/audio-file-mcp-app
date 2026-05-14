import { getInstance, instantiate } from "../dsp/wasm-dsp.gen";
import type { Analyzer, AnalyzerChunk } from "./analyzer";
import { FFT_SIZE, HOP, type FrameConsumer } from "./frame-router";
import {
    formatGridLabel,
    frequencyToY,
    visibleGridFrequencies,
} from "./frequency-grid";

const MAX_COLS = 4000;
const NUM_BINS = 256;
const REDRAW_INTERVAL_MS = 50;
const MIN_HZ = 20;
const FLOOR_DB = -100;
const CEIL_DB = 0;
const DB_MULT = 10; // energy semantics: db = 10*log10(...)

// Per-cell 0 dB reference (linear energy): the |X_h|² that one frame of a
// full-scale Hann-windowed sine deposits into its dominant log-band cell.
// Pinned empirically (see spectrogram.test.ts MAG_REF_ENERGY calibration).
// Must stay in sync with MAG_REF_ENERGY in src/wasm/reassign.c.
const MAG_REF_ENERGY = 387920;

// Matplotlib "inferno" sampled at 9 stops; lerp in linear RGB between them.
const INFERNO_STOPS: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 4],
    [24, 15, 61],
    [66, 10, 104],
    [120, 28, 109],
    [171, 51, 98],
    [217, 80, 64],
    [245, 125, 21],
    [251, 192, 50],
    [252, 255, 164],
];

export function makeColorLut(): Uint8ClampedArray {
    const lut = new Uint8ClampedArray(256 * 4);
    const segments = INFERNO_STOPS.length - 1;
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        const s = t * segments;
        const idx = Math.min(segments - 1, Math.floor(s));
        const f = s - idx;
        const a = INFERNO_STOPS[idx];
        const b = INFERNO_STOPS[idx + 1];
        lut[i * 4 + 0] = Math.round(a[0] + (b[0] - a[0]) * f);
        lut[i * 4 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
        lut[i * 4 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

const COLOR_LUT = makeColorLut();

type WasmModule = {
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    _malloc(n: number): number;
    _free(p: number): void;
    _reassign_init(
        fftSize: number, hop: number,
        sampleRate: number, maxCols: number, numBins: number,
        minHz: number, framesPerCol: number,
    ): number;
    _reassign_set_frames_per_col(framesPerCol: number): void;
    _reassign_reset(): void;
    _reassign_process_frame(raw: number, frameIndex: number): number;
    _reassign_render(
        decodedCols: number,
        floorDb: number, ceilDb: number,
        ref: number, floorValue: number, dbMult: number,
        lut: number, out: number,
    ): void;
    _reassign_get_current_col(): number;
    _reassign_get_frames_in_col(): number;
    _reassign_get_max_col_touched(): number;
};

export class SpectrogramAnalyzer implements FrameConsumer, Analyzer {
    private mod: WasmModule | null = null;
    private rawPtr = 0;
    private outPtr = 0;
    private lutPtr = 0;
    private outBytes = MAX_COLS * NUM_BINS * 4;
    private framesPerCol = 1;
    private durationSeconds: number | null = null;
    private sampleRate = 0;
    private initialized = false;

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
        if (this.initialized && this.mod) {
            this.mod._reassign_set_frames_per_col(this.framesPerCol);
        }
        this.redraw();
    }

    init(sampleRate: number): void {
        this.sampleRate = sampleRate;
        if (this.durationSeconds !== null) {
            const totalFrames = Math.ceil((this.durationSeconds * sampleRate) / HOP);
            this.framesPerCol = Math.max(1, Math.ceil(totalFrames / MAX_COLS));
        }
        this.ensureWasm(sampleRate);
        if (this.mod && this.initialized) {
            this.mod._reassign_reset();
            this.mod._reassign_set_frames_per_col(this.framesPerCol);
        }
    }

    feed(_chunk: AnalyzerChunk): void {
        // Driven by FrameRouter via onFrame.
    }

    onFrame(frame: Float32Array, frameIndex: number, sampleRate: number): void {
        if (!this.initialized || !this.mod) return;
        if (sampleRate !== this.sampleRate) {
            // Sample rate changed mid-stream: reinit. Rare in practice (would
            // require switching files); decode resets the whole worker anyway.
            this.sampleRate = sampleRate;
            this.ensureWasm(sampleRate);
            this.mod._reassign_reset();
            this.mod._reassign_set_frames_per_col(this.framesPerCol);
        }
        const mod = this.mod;
        mod.HEAPF32.set(frame, this.rawPtr >> 2);
        mod._reassign_process_frame(this.rawPtr, frameIndex);
        this.maybeRedraw();
    }

    finalize(): void {
        this.redraw();
    }

    dispose(): void {
        if (this.mod) {
            if (this.rawPtr) this.mod._free(this.rawPtr);
            if (this.outPtr) this.mod._free(this.outPtr);
            if (this.lutPtr) this.mod._free(this.lutPtr);
        }
        this.rawPtr = 0;
        this.outPtr = 0;
        this.lutPtr = 0;
        this.initialized = false;
        this.mod = null;
    }

    private ensureWasm(sampleRate: number): void {
        if (!this.mod) {
            // Caller must have awaited instantiate() before any DSP use; same
            // contract as createFft / createLoudness.
            this.mod = getInstance() as WasmModule;
        }
        const mod = this.mod;
        if (!this.rawPtr) {
            this.rawPtr = mod._malloc(FFT_SIZE * 4);
            if (!this.rawPtr) throw new Error("spectrogram raw _malloc failed");
        }
        if (!this.outPtr) {
            this.outPtr = mod._malloc(this.outBytes);
            if (!this.outPtr) throw new Error("spectrogram out _malloc failed");
        }
        if (!this.lutPtr) {
            this.lutPtr = mod._malloc(COLOR_LUT.length);
            if (!this.lutPtr) throw new Error("spectrogram lut _malloc failed");
            mod.HEAPU8.set(COLOR_LUT, this.lutPtr);
        }
        mod._reassign_init(
            FFT_SIZE, HOP,
            sampleRate, MAX_COLS, NUM_BINS,
            MIN_HZ, this.framesPerCol,
        );
        this.initialized = true;
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
        const mod = this.mod;
        if (!ctx || !mod || !this.initialized) return;
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

        const nominalCol = mod._reassign_get_current_col();
        const framesInCol = mod._reassign_get_frames_in_col();
        const maxTouched = mod._reassign_get_max_col_touched();
        const decodedCols = Math.max(
            nominalCol + (framesInCol > 0 ? 1 : 0),
            maxTouched + 1,
        );
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

        const ref = this.framesPerCol * MAG_REF_ENERGY;
        const floorValue = ref * Math.pow(10, FLOOR_DB / DB_MULT);
        mod._reassign_render(
            decodedCols,
            FLOOR_DB, CEIL_DB,
            ref, floorValue, DB_MULT,
            this.lutPtr, this.outPtr,
        );

        const rgbaBytes = decodedCols * NUM_BINS * 4;
        const buf = new Uint8ClampedArray(rgbaBytes);
        buf.set(mod.HEAPU8.subarray(this.outPtr, this.outPtr + rgbaBytes));
        const imgData = new ImageData(buf, decodedCols, NUM_BINS);

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

        this.drawGrid();
    }

    private drawGrid(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        if (this.sampleRate <= 0) return;
        if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

        const freqs = visibleGridFrequencies(this.sampleRate);
        if (freqs.length === 0) return;

        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        ctx.globalCompositeOperation = "difference";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.25;
        for (const hz of freqs) {
            const y = frequencyToY(hz, this.cssHeight, this.sampleRate);
            if (y === null) continue;
            const py = Math.round(y) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(this.cssWidth, py);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        const inset = 4;
        for (const hz of freqs) {
            const y = frequencyToY(hz, this.cssHeight, this.sampleRate);
            if (y === null) continue;
            const label = formatGridLabel(hz);
            ctx.textAlign = "left";
            ctx.fillText(label, inset, y);
            ctx.textAlign = "right";
            ctx.fillText(label, this.cssWidth - inset, y);
        }

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
}

export async function ensureSpectrogramDspReady(): Promise<void> {
    await instantiate();
}
