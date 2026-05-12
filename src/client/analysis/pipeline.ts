import type { Analyzer, AnalyzerChunk } from "./analyzer";

export class AnalysisPipeline {
    private readonly analyzers: Analyzer[];
    private sampleRate = 0;
    private decodedSamples = 0;
    private initialized = false;

    constructor(analyzers: Analyzer[]) {
        this.analyzers = analyzers;
    }

    feed(chunk: { sampleRate: number; channelData: Float32Array[] }): void {
        if (!this.initialized) {
            this.sampleRate = chunk.sampleRate;
            for (const a of this.analyzers) {
                a.init(this.sampleRate, chunk.channelData.length);
            }
            this.initialized = true;
        }
        const ac: AnalyzerChunk = {
            channelData: chunk.channelData,
            sampleRate: this.sampleRate,
            startSample: this.decodedSamples,
        };
        for (const a of this.analyzers) a.feed(ac);
        this.decodedSamples += chunk.channelData[0]?.length ?? 0;
    }

    finalize(): void {
        if (!this.initialized) return;
        for (const a of this.analyzers) a.finalize();
    }

    get totalSamples(): number {
        return this.decodedSamples;
    }
}
