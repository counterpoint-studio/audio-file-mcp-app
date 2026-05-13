/// <reference lib="WebWorker" />
declare const self: DedicatedWorkerGlobalScope;
export {};

import decode, { type DecodedChunk } from "audio-decode";
import { AnalysisPipeline } from "./analysis/pipeline";
import { FrameRouter } from "./analysis/frame-router";
import { LoudnessAnalyzer, type LoudnessSummary } from "./analysis/loudness";
import { SampleStatsAnalyzer } from "./analysis/sample-stats";
import { SpectrogramAnalyzer } from "./analysis/spectrogram";
import { TimeSeriesStore } from "./analysis/time-series";
import { WaveformBandEnergyAnalyzer } from "./analysis/waveform-band-energy";
import { WaveformPeaksAnalyzer } from "./analysis/waveform-peaks";
import {
    STREAMABLE_DECODE_FORMATS,
    type AudioDecodeFormat,
} from "./audio-formats";
import { shouldApplyFinalDuration } from "./analysis/duration-correction";
import { instantiate as instantiateDsp } from "./dsp/wasm-dsp.gen";
import { boundWavBlob } from "./wav-data-bound";

type InitMsg = {
    type: "init";
    canvas: OffscreenCanvas;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    blob: Blob;
    format: AudioDecodeFormat | null;
    durationSeconds: number | null;
    durationExact: boolean;
    theme: "light" | "dark";
};

type ThemeMsg = { type: "theme"; theme: "light" | "dark" };

type ResizeMsg = {
    type: "resize";
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

type SpectrogramCanvasMsg = {
    type: "spectrogram-canvas";
    canvas: OffscreenCanvas;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

type SpectrogramResizeMsg = {
    type: "spectrogram-resize";
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

type QueryAtMsg = { type: "queryAt"; id: number; seconds: number };

type InMsg =
    | InitMsg
    | ResizeMsg
    | SpectrogramCanvasMsg
    | SpectrogramResizeMsg
    | QueryAtMsg
    | ThemeMsg;

const LIVE_INTERVAL_MS = 250;

let decoderInfoSent = false;
function maybePostDecoderInfo(): void {
    if (decoderInfoSent) return;
    if (pipeline.totalSamples <= 0) return;
    decoderInfoSent = true;
    self.postMessage({
        type: "decoder-info",
        channels: pipeline.numChannelsObserved,
        sampleRate: pipeline.sampleRateObserved,
    });
}

const timeSeries = new TimeSeriesStore();
const bandEnergy = new WaveformBandEnergyAnalyzer();
const waveform = new WaveformPeaksAnalyzer(bandEnergy);
const sampleStats = new SampleStatsAnalyzer(timeSeries);
const loudness = new LoudnessAnalyzer(timeSeries);
const spectrogram = new SpectrogramAnalyzer();
const frameRouter = new FrameRouter([spectrogram, bandEnergy]);
const pipeline = new AnalysisPipeline([
    waveform,
    sampleStats,
    loudness,
    frameRouter,
    spectrogram,
    bandEnergy,
]);
const dspReady = instantiateDsp();
let loudnessSummary: LoudnessSummary | null = null;
let decodeAbort = false;
let lastLivePostAt = 0;
let initialDuration: number | null = null;
let initialDurationExact = false;

self.onmessage = (e: MessageEvent<InMsg>) => {
    const msg = e.data;
    switch (msg.type) {
        case "init":
            initialDuration = msg.durationSeconds;
            initialDurationExact = msg.durationExact;
            waveform.setTheme(msg.theme);
            waveform.setCanvas(
                msg.canvas,
                msg.cssWidth,
                msg.cssHeight,
                msg.dpr,
            );
            if (initialDuration !== null) {
                waveform.setDuration(initialDuration);
                spectrogram.setDuration(initialDuration);
            }
            void startDecode(msg.blob, msg.format);
            break;
        case "resize":
            waveform.resize(msg.cssWidth, msg.cssHeight, msg.dpr);
            break;
        case "spectrogram-canvas":
            spectrogram.setCanvas(
                msg.canvas,
                msg.cssWidth,
                msg.cssHeight,
                msg.dpr,
            );
            break;
        case "spectrogram-resize":
            spectrogram.resize(msg.cssWidth, msg.cssHeight, msg.dpr);
            break;
        case "queryAt":
            handleQueryAt(msg.id, msg.seconds);
            break;
        case "theme":
            waveform.setTheme(msg.theme);
            break;
    }
};

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
    let lastYieldAt = performance.now();
    for await (const chunk of decoder(stream)) {
        if (decodeAbort) return;
        pipeline.feed(chunk);
        maybePostDecoderInfo();
        maybePostLive();
        // Yield to the macrotask queue periodically so OffscreenCanvas commits
        // reach the displayed placeholder canvas during decode rather than only
        // after the for-await loop returns.
        const now = performance.now();
        if (now - lastYieldAt >= 16) {
            lastYieldAt = now;
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
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
        await dspReady;
        if (decodeAbort) return;
        if (STREAMABLE_DECODE_FORMATS.has(format)) {
            const sourceBlob = format === "wav" ? await boundWavBlob(blob) : blob;
            if (decodeAbort) return;
            await runStreaming(sourceBlob, format);
        } else {
            const buf = await blob.arrayBuffer();
            if (decodeAbort) return;
            const result = await wholeFileDecoder(format)(buf);
            if (decodeAbort) return;
            pipeline.feed(result);
            maybePostDecoderInfo();
            maybePostLive();
        }
        pipeline.finalize();
        applyFinalDuration();
        loudnessSummary = loudness.summary();
        postLive();
        postFinal();
        self.postMessage({
            type: "done",
            decodedSamples: pipeline.totalSamples,
            peakCount: waveform.peakCount,
        });
    } catch (err) {
        self.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

function applyFinalDuration(): void {
    const sr = pipeline.sampleRateObserved;
    const samples = pipeline.totalSamples;
    if (sr <= 0 || samples <= 0) return;
    const actual = samples / sr;
    if (shouldApplyFinalDuration(initialDuration, initialDurationExact, actual)) {
        waveform.setDuration(actual);
        spectrogram.setDuration(actual);
    }
}

function maybePostLive(): void {
    const now = performance.now();
    if (now - lastLivePostAt < LIVE_INTERVAL_MS) return;
    lastLivePostAt = now;
    postLive();
}

function postLive(): void {
    self.postMessage({ type: "live-metrics", metrics: computeRunning() });
}

function postFinal(): void {
    self.postMessage({ type: "final-metrics", metrics: computeRunning() });
}

function computeRunning(): {
    samplePeak: number;
    rms: number;
    truePeak: number;
    momentary: number;
    shortTerm: number;
    integrated: number;
    lra: number;
    clipping: number;
} {
    const count = timeSeries.count;
    if (count === 0) {
        return {
            samplePeak: NaN,
            rms: NaN,
            truePeak: NaN,
            momentary: NaN,
            shortTerm: NaN,
            integrated: NaN,
            lra: NaN,
            clipping: 0,
        };
    }
    let maxPeak = 0;
    let sumSq = 0;
    let clips = 0;
    for (let i = 0; i < count; i++) {
        const p = timeSeries.samplePeak[i];
        if (p > maxPeak) maxPeak = p;
        const r = timeSeries.rms[i];
        sumSq += r * r;
        clips += timeSeries.clipping[i];
    }
    return {
        samplePeak: maxPeak,
        rms: Math.sqrt(sumSq / count),
        truePeak: loudnessSummary ? loudnessSummary.truePeak : NaN,
        momentary: timeSeries.momentary[count - 1],
        shortTerm: timeSeries.shortTerm[count - 1],
        integrated: loudnessSummary ? loudnessSummary.integrated : NaN,
        lra: loudnessSummary ? loudnessSummary.lra : NaN,
        clipping: clips,
    };
}

function handleQueryAt(id: number, seconds: number): void {
    const idx = timeSeries.indexAtSeconds(seconds);
    if (idx < 0) {
        self.postMessage({ type: "query-result", id, seconds, values: null });
        return;
    }
    self.postMessage({
        type: "query-result",
        id,
        seconds,
        values: {
            samplePeak: timeSeries.samplePeak[idx],
            rms: timeSeries.rms[idx],
            truePeak: timeSeries.truePeak[idx],
            momentary: timeSeries.momentary[idx],
            shortTerm: timeSeries.shortTerm[idx],
            clipping: timeSeries.clipping[idx],
        },
    });
}
