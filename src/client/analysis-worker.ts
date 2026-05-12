/// <reference lib="WebWorker" />
declare const self: DedicatedWorkerGlobalScope;
export {};

import decode, { type DecodedChunk } from "audio-decode";
import { AnalysisPipeline } from "./analysis/pipeline";
import { SampleStatsAnalyzer } from "./analysis/sample-stats";
import { TimeSeriesStore } from "./analysis/time-series";
import { WaveformPeaksAnalyzer } from "./analysis/waveform-peaks";
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

type QueryAtMsg = { type: "queryAt"; id: number; seconds: number };

type InMsg = InitMsg | ResizeMsg | DurationMsg | QueryAtMsg;

const LIVE_INTERVAL_MS = 250;

const timeSeries = new TimeSeriesStore();
const waveform = new WaveformPeaksAnalyzer();
const sampleStats = new SampleStatsAnalyzer(timeSeries);
const pipeline = new AnalysisPipeline([waveform, sampleStats]);
let decodeAbort = false;
let lastLivePostAt = 0;

self.onmessage = (e: MessageEvent<InMsg>) => {
    const msg = e.data;
    switch (msg.type) {
        case "init":
            waveform.setCanvas(
                msg.canvas,
                msg.cssWidth,
                msg.cssHeight,
                msg.dpr,
            );
            void startDecode(msg.blob, msg.format);
            break;
        case "resize":
            waveform.resize(msg.cssWidth, msg.cssHeight, msg.dpr);
            break;
        case "duration":
            waveform.setDuration(msg.seconds);
            break;
        case "queryAt":
            handleQueryAt(msg.id, msg.seconds);
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
    for await (const chunk of decoder(stream)) {
        if (decodeAbort) return;
        pipeline.feed(chunk);
        maybePostLive();
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
            pipeline.feed(result);
            maybePostLive();
        }
        pipeline.finalize();
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
        truePeak: NaN,
        momentary: timeSeries.momentary[count - 1],
        shortTerm: timeSeries.shortTerm[count - 1],
        integrated: NaN,
        lra: NaN,
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
