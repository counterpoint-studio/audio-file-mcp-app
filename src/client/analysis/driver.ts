import { AnalysisPipeline } from "./pipeline";
import { FrameRouter } from "./frame-router";
import { LoudnessAnalyzer, type LoudnessSummary } from "./loudness";
import { SampleStatsAnalyzer } from "./sample-stats";
import { SpectrogramAnalyzer } from "./spectrogram";
import { TimeSeriesStore } from "./time-series";
import { WaveformBandEnergyAnalyzer } from "./waveform-band-energy";
import { WaveformPeaksAnalyzer } from "./waveform-peaks";
import { isMediabunnySupported, type AudioFormat } from "../audio-formats";
import { shouldApplyFinalDuration } from "./duration-correction";
import { instantiate as instantiateDsp } from "../dsp/wasm-dsp.gen";
import { decodeWithMediabunny } from "./mediabunny-decode";
import { createChunkStore, type ChunkStore } from "../chunk-store";
import { createChunkBus, type ChunkBus } from "../chunk-bus";
import { createChunkedSource } from "../chunked-source";
import type { Source } from "mediabunny";

export type InitMsg = {
    type: "init";
    canvas: OffscreenCanvas;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    sizeBytes: number;
    format: AudioFormat | null;
    durationSeconds: number | null;
    durationExact: boolean;
    theme: "light" | "dark";
};

export type ChunkMsg = {
    type: "chunk";
    start: number;
    blob: Blob;
};

export type ThemeMsg = { type: "theme"; theme: "light" | "dark" };

export type ResizeMsg = {
    type: "resize";
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

export type SpectrogramCanvasMsg = {
    type: "spectrogram-canvas";
    canvas: OffscreenCanvas;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

export type SpectrogramResizeMsg = {
    type: "spectrogram-resize";
    cssWidth: number;
    cssHeight: number;
    dpr: number;
};

export type QueryAtMsg = { type: "queryAt"; id: number; seconds: number };

export type AnalysisInMsg =
    | InitMsg
    | ChunkMsg
    | ResizeMsg
    | SpectrogramCanvasMsg
    | SpectrogramResizeMsg
    | QueryAtMsg
    | ThemeMsg;

export type LiveMetricsPayload = {
    samplePeak: number;
    rms: number;
    truePeak: number;
    momentary: number;
    shortTerm: number;
    integrated: number;
    lra: number;
    clipping: number;
};

export type QueryValues = {
    samplePeak: number;
    rms: number;
    truePeak: number;
    momentary: number;
    shortTerm: number;
    clipping: number;
};

export type AnalysisOutMsg =
    | { type: "request-range"; start: number; end: number }
    | { type: "decoder-info"; channels: number; sampleRate: number }
    | { type: "live-metrics"; metrics: LiveMetricsPayload }
    | { type: "final-metrics"; metrics: LiveMetricsPayload }
    | {
          type: "query-result";
          id: number;
          seconds: number;
          values: QueryValues | null;
      }
    | { type: "error"; message: string }
    | {
          type: "done";
          reason?: "unsupported";
          decodedSamples?: number;
          peakCount?: number;
      };

export type AnalysisDriver = {
    handleMessage(msg: AnalysisInMsg): void;
    /** Abort in-flight decode; idempotent. */
    terminate(): void;
};

const LIVE_INTERVAL_MS = 250;

export function createAnalysisDriver(opts: {
    post: (msg: AnalysisOutMsg) => void;
    decodeYieldEveryMs?: number;
}): AnalysisDriver {
    const { post } = opts;
    const decodeYieldEveryMs = opts.decodeYieldEveryMs;

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

    let decoderInfoSent = false;
    let loudnessSummary: LoudnessSummary | null = null;
    let decodeAbort = false;
    let lastLivePostAt = 0;
    let initialDuration: number | null = null;
    let initialDurationExact = false;
    let chunkStore: ChunkStore | null = null;
    let chunkBus: ChunkBus | null = null;

    function maybePostDecoderInfo(): void {
        if (decoderInfoSent) return;
        if (pipeline.totalSamples <= 0) return;
        decoderInfoSent = true;
        post({
            type: "decoder-info",
            channels: pipeline.numChannelsObserved,
            sampleRate: pipeline.sampleRateObserved,
        });
    }

    function handleMessage(msg: AnalysisInMsg): void {
        switch (msg.type) {
            case "init": {
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
                chunkStore = createChunkStore(msg.sizeBytes);
                chunkBus = createChunkBus();
                const source = createChunkedSource({
                    store: chunkStore,
                    loader: {
                        request: (start, end) => {
                            post({
                                type: "request-range",
                                start,
                                end,
                            });
                        },
                    },
                    onChunk: chunkBus.subscribe,
                });
                void startDecode(source, msg.format);
                break;
            }
            case "chunk":
                if (chunkStore && chunkBus) {
                    chunkStore.add(msg.start, msg.blob);
                    chunkBus.emit();
                }
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
    }

    async function startDecode(
        source: Source,
        format: AudioFormat | null,
    ): Promise<void> {
        if (!isMediabunnySupported(format)) {
            post({ type: "done", reason: "unsupported" });
            return;
        }
        try {
            await dspReady;
            if (decodeAbort) return;

            await decodeWithMediabunny(source, {
                isAborted: () => decodeAbort,
                yieldEveryMs: decodeYieldEveryMs,
                onChunk: (chunk) => {
                    pipeline.feed(chunk);
                    maybePostDecoderInfo();
                    maybePostLive();
                },
            });
            if (decodeAbort) return;

            pipeline.finalize();
            applyFinalDuration();
            loudnessSummary = loudness.summary();
            postLive();
            postFinal();
            post({
                type: "done",
                decodedSamples: pipeline.totalSamples,
                peakCount: waveform.peakCount,
            });
        } catch (err) {
            post({
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
        if (
            shouldApplyFinalDuration(
                initialDuration,
                initialDurationExact,
                actual,
            )
        ) {
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
        post({ type: "live-metrics", metrics: computeRunning() });
    }

    function postFinal(): void {
        post({ type: "final-metrics", metrics: computeRunning() });
    }

    function computeRunning(): LiveMetricsPayload {
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
            post({ type: "query-result", id, seconds, values: null });
            return;
        }
        post({
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

    function terminate(): void {
        decodeAbort = true;
    }

    return { handleMessage, terminate };
}
