import type { Analyzer, AnalyzerChunk } from "./analyzer";
import { TIMESERIES_HZ, TimeSeriesStore } from "./time-series";

const CLIP_THRESHOLD = 0.99999;

export class SampleStatsAnalyzer implements Analyzer {
    private readonly store: TimeSeriesStore;
    private samplesPerStep = 0;
    private windowSampleCount = 0;
    private windowPeak = 0;
    private windowSumSq = 0;
    private windowClips = 0;

    constructor(store: TimeSeriesStore) {
        this.store = store;
    }

    init(sampleRate: number): void {
        this.samplesPerStep = Math.max(
            1,
            Math.round(sampleRate / TIMESERIES_HZ),
        );
    }

    feed(chunk: AnalyzerChunk): void {
        const channels = chunk.channelData;
        const nc = channels.length;
        if (nc === 0) return;
        const n = channels[0].length;
        for (let i = 0; i < n; i++) {
            let mx = 0;
            let ss = 0;
            for (let c = 0; c < nc; c++) {
                const v = channels[c][i];
                const av = v < 0 ? -v : v;
                if (av > mx) mx = av;
                ss += v * v;
                if (av >= CLIP_THRESHOLD) this.windowClips++;
            }
            if (mx > this.windowPeak) this.windowPeak = mx;
            this.windowSumSq += ss / nc;
            this.windowSampleCount++;
            if (this.windowSampleCount >= this.samplesPerStep) this.flushWindow();
        }
    }

    finalize(): void {
        if (this.windowSampleCount > 0) this.flushWindow();
    }

    private flushWindow(): void {
        const rms = Math.sqrt(this.windowSumSq / this.windowSampleCount);
        this.store.append(this.windowPeak, rms, this.windowClips);
        this.windowSampleCount = 0;
        this.windowPeak = 0;
        this.windowSumSq = 0;
        this.windowClips = 0;
    }
}
