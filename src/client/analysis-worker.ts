/// <reference lib="WebWorker" />
declare const self: DedicatedWorkerGlobalScope;
export {};

import decode, { type DecodedChunk } from "audio-decode";
import { AnalysisPipeline } from "./analysis/pipeline";
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

type InMsg = InitMsg | ResizeMsg | DurationMsg;

const waveform = new WaveformPeaksAnalyzer();
const pipeline = new AnalysisPipeline([waveform]);
let decodeAbort = false;

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
        }
        pipeline.finalize();
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
