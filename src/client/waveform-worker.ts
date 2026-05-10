/// <reference lib="WebWorker" />
declare const self: DedicatedWorkerGlobalScope;
export {};

import decode, { type DecodedChunk } from "audio-decode";
import {
    STREAMABLE_DECODE_FORMATS,
    type AudioDecodeFormat,
} from "./audio-formats";

type InitMsg = {
    type: "init";
    canvas: OffscreenCanvas;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    blob: Blob;
    format: AudioDecodeFormat | null;
};

type ResizeMsg = {
    type: "resize";
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

type DurationMsg = { type: "duration"; seconds: number };

type InMsg = InitMsg | ResizeMsg | DurationMsg;

const PEAKS_PER_SECOND = 200;
const REDRAW_INTERVAL_MS = 50;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let cssWidth = 0;
let cssHeight = 0;

class GrowablePeaks {
    private buf: Float32Array;
    count = 0;
    constructor(initialBuckets: number) {
        this.buf = new Float32Array(Math.max(2, initialBuckets) * 2);
    }
    append(min: number, max: number): void {
        if ((this.count + 1) * 2 > this.buf.length) {
            const next = new Float32Array(this.buf.length * 2);
            next.set(this.buf);
            this.buf = next;
        }
        this.buf[this.count * 2] = min;
        this.buf[this.count * 2 + 1] = max;
        this.count++;
    }
    minAt(i: number): number {
        return this.buf[i * 2];
    }
    maxAt(i: number): number {
        return this.buf[i * 2 + 1];
    }
}

type ReducerState = {
    sampleRate: number;
    samplesPerBucket: number;
    bucketSampleCount: number;
    bucketMin: number;
    bucketMax: number;
    peaks: GrowablePeaks;
    decodedSamples: number;
};

let reducer: ReducerState | null = null;
let decodeAbort = false;
let durationSeconds: number | null = null;
let lastRedrawAt = 0;

self.onmessage = (e: MessageEvent<InMsg>) => {
    const msg = e.data;
    switch (msg.type) {
        case "init":
            canvas = msg.canvas;
            applySize(msg.cssWidth, msg.cssHeight, msg.dpr);
            redraw();
            void startDecode(msg.blob, msg.format);
            break;
        case "resize":
            applySize(msg.cssWidth, msg.cssHeight, msg.dpr);
            redraw();
            break;
        case "duration":
            durationSeconds = msg.seconds;
            redraw();
            break;
    }
};

function canDrawWaveform(): boolean {
    return (
        ctx !== null &&
        reducer !== null &&
        durationSeconds !== null &&
        reducer.peaks.count > 0 &&
        cssWidth > 0 &&
        cssHeight > 0
    );
}

function redraw(): void {
    if (canDrawWaveform()) drawWaveform();
    else redrawPlaceholder();
}

function applySize(w: number, h: number, ratio: number): void {
    if (!canvas) return;
    cssWidth = w;
    cssHeight = h;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    ctx = canvas.getContext("2d");
    ctx?.scale(ratio, ratio);
}

function redrawPlaceholder(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = "#bbb";
    ctx.beginPath();
    ctx.moveTo(0, cssHeight / 2);
    ctx.lineTo(cssWidth, cssHeight / 2);
    ctx.stroke();
}

function maybeRedraw(): void {
    const now = performance.now();
    if (now - lastRedrawAt >= REDRAW_INTERVAL_MS) {
        lastRedrawAt = now;
        drawWaveform();
    }
}

function drawWaveform(): void {
    if (!ctx || !reducer || durationSeconds === null) return;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const decodedBuckets = reducer.peaks.count;
    if (decodedBuckets === 0) return;

    const totalBuckets = Math.max(
        1,
        Math.round(durationSeconds * PEAKS_PER_SECOND),
    );
    const decodedColumns = Math.min(
        cssWidth,
        Math.ceil((decodedBuckets / totalBuckets) * cssWidth),
    );
    if (decodedColumns <= 0) return;
    const bucketsPerColumn = decodedBuckets / decodedColumns;
    const cy = cssHeight / 2;
    const halfH = cssHeight / 2 - 1;

    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#7aa";
    ctx.beginPath();
    for (let col = 0; col < decodedColumns; col++) {
        const start = Math.floor(col * bucketsPerColumn);
        const end = Math.min(
            decodedBuckets,
            Math.floor((col + 1) * bucketsPerColumn),
        );
        let mn = Infinity;
        let mx = -Infinity;
        for (let b = start; b < end; b++) {
            const bmn = reducer.peaks.minAt(b);
            const bmx = reducer.peaks.maxAt(b);
            if (bmn < mn) mn = bmn;
            if (bmx > mx) mx = bmx;
        }
        if (mn === Infinity) continue;
        const yTop = cy - mx * halfH;
        const yBot = cy - mn * halfH;
        ctx.rect(col, yTop, 1, Math.max(1, yBot - yTop));
    }
    ctx.fill();
}

function feedChunk(chunk: DecodedChunk): void {
    if (!reducer) {
        const samplesPerBucket = Math.max(
            1,
            Math.round(chunk.sampleRate / PEAKS_PER_SECOND),
        );
        reducer = {
            sampleRate: chunk.sampleRate,
            samplesPerBucket,
            bucketSampleCount: 0,
            bucketMin: Infinity,
            bucketMax: -Infinity,
            peaks: new GrowablePeaks(60 * PEAKS_PER_SECOND),
            decodedSamples: 0,
        };
    }
    const r = reducer;
    const channels = chunk.channelData;
    const numChannels = channels.length;
    if (numChannels === 0) return;
    const sampleCount = channels[0].length;
    for (let i = 0; i < sampleCount; i++) {
        let mn = Infinity;
        let mx = -Infinity;
        for (let c = 0; c < numChannels; c++) {
            const v = channels[c][i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        if (mn < r.bucketMin) r.bucketMin = mn;
        if (mx > r.bucketMax) r.bucketMax = mx;
        r.bucketSampleCount++;
        if (r.bucketSampleCount >= r.samplesPerBucket) {
            r.peaks.append(r.bucketMin, r.bucketMax);
            r.bucketSampleCount = 0;
            r.bucketMin = Infinity;
            r.bucketMax = -Infinity;
        }
    }
    r.decodedSamples += sampleCount;
    maybeRedraw();
}

function flushTrailingBucket(): void {
    if (!reducer) return;
    if (reducer.bucketSampleCount > 0) {
        reducer.peaks.append(reducer.bucketMin, reducer.bucketMax);
        reducer.bucketSampleCount = 0;
        reducer.bucketMin = Infinity;
        reducer.bucketMax = -Infinity;
    }
}

type StreamingDecoderFn = (
    s: ReadableStream<Uint8Array>,
) => AsyncIterable<DecodedChunk>;

function streamingDecoder(format: AudioDecodeFormat): StreamingDecoderFn {
    return decode[format] as unknown as StreamingDecoderFn;
}

function wholeFileDecoder(
    format: AudioDecodeFormat,
): (input: ArrayBuffer | Uint8Array) => Promise<DecodedChunk> {
    return decode[format];
}

async function runStreaming(
    blob: Blob,
    format: AudioDecodeFormat,
): Promise<void> {
    const decoder = streamingDecoder(format);
    const stream = blob.stream();
    for await (const chunk of decoder(stream)) {
        if (decodeAbort) return;
        feedChunk(chunk);
    }
}

async function startDecode(
    blob: Blob,
    format: AudioDecodeFormat | null,
): Promise<void> {
    if (!format) {
        self.postMessage({ type: "done", reason: "unsupported" });
        return;
    }
    try {
        if (STREAMABLE_DECODE_FORMATS.has(format)) {
            await runStreaming(blob, format);
        } else {
            const buf = await blob.arrayBuffer();
            if (decodeAbort) return;
            const result = await wholeFileDecoder(format)(buf);
            if (decodeAbort) return;
            feedChunk(result);
        }
        flushTrailingBucket();
        drawWaveform();
        self.postMessage({
            type: "done",
            sampleRate: reducer?.sampleRate ?? 0,
            decodedSamples: reducer?.decodedSamples ?? 0,
            peakCount: reducer?.peaks.count ?? 0,
        });
    } catch (err) {
        self.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
}
