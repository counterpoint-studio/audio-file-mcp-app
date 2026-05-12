import { createLoudness, type Loudness, type LoudnessMode } from "../dsp/loudness";
import type { Analyzer, AnalyzerChunk } from "./analyzer";
import { TIMESERIES_HZ, type TimeSeriesStore } from "./time-series";

export type LoudnessFactory = (
    sampleRate: number,
    channels: number,
    mode: LoudnessMode,
) => Loudness;

const LOUDNESS_MODE: LoudnessMode = "M|S|I|LRA|TP|SP";

export type LoudnessSummary = {
    integrated: number;
    lra: number;
    truePeak: number;
    samplePeak: number;
};

export class LoudnessAnalyzer implements Analyzer {
    private readonly store: TimeSeriesStore;
    private readonly loudnessFactory: LoudnessFactory;
    private loudness: Loudness | null = null;
    private samplesPerStep = 0;
    private samplesSinceLastPoll = 0;
    private pollIndex = 0;

    constructor(store: TimeSeriesStore, loudnessFactory: LoudnessFactory = createLoudness) {
        this.store = store;
        this.loudnessFactory = loudnessFactory;
    }

    init(sampleRate: number, numChannels: number): void {
        this.loudness = this.loudnessFactory(sampleRate, numChannels, LOUDNESS_MODE);
        this.samplesPerStep = Math.max(1, Math.round(sampleRate / TIMESERIES_HZ));
        this.samplesSinceLastPoll = 0;
        this.pollIndex = 0;
    }

    feed(chunk: AnalyzerChunk): void {
        if (!this.loudness) return;
        const frames = chunk.channelData[0]?.length ?? 0;
        if (frames === 0) return;
        this.loudness.addFrames(chunk.channelData);
        this.samplesSinceLastPoll += frames;
        while (this.samplesSinceLastPoll >= this.samplesPerStep) {
            const m = this.loudness.momentary();
            const s = this.loudness.shortterm();
            this.store.setAt(
                this.pollIndex,
                "momentary",
                Number.isFinite(m) ? m : -Infinity,
            );
            this.store.setAt(
                this.pollIndex,
                "shortTerm",
                Number.isFinite(s) ? s : -Infinity,
            );
            this.pollIndex++;
            this.samplesSinceLastPoll -= this.samplesPerStep;
        }
    }

    finalize(): void {
        // Momentary/short-term are already up-to-date through the last full
        // step; tail samples below one step contribute to summary readings
        // but not to per-step TimeSeries entries.
    }

    summary(): LoudnessSummary {
        if (!this.loudness) {
            return {
                integrated: -Infinity,
                lra: 0,
                truePeak: -Infinity,
                samplePeak: -Infinity,
            };
        }
        return {
            integrated: this.loudness.global(),
            lra: this.loudness.range(),
            truePeak: this.loudness.truePeak(),
            samplePeak: this.loudness.samplePeak(),
        };
    }

    dispose(): void {
        if (this.loudness) {
            this.loudness.dispose();
            this.loudness = null;
        }
    }
}
