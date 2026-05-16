import type { Analyzer, AnalyzerChunk } from "./analyzer";

export class AnalysisPipeline {
    private readonly analyzers: Analyzer[];
    private sampleRate = 0;
    private numChannels = 0;
    private decodedSamples = 0;
    private initialized = false;

    constructor(analyzers: Analyzer[]) {
        this.analyzers = analyzers;
    }

    feed(chunk: { sampleRate: number; channelData: Float32Array[] }): void {
        const incoming = chunk.channelData;
        if (incoming.length === 0) return;
        const frames = incoming[0]?.length ?? 0;
        if (frames === 0) return;

        if (!this.initialized) {
            this.sampleRate = chunk.sampleRate;
            this.numChannels = incoming.length;
            for (const a of this.analyzers) {
                a.init(this.sampleRate, this.numChannels);
            }
            this.initialized = true;
        } else if (incoming.length !== this.numChannels) {
            // Mediabunny emits stable channel counts per buffer; a mismatch
            // here is a decoder regression, not silent input data we should
            // paper over.
            throw new Error(
                `AnalysisPipeline: chunk channel count ${incoming.length} differs from initial ${this.numChannels}`,
            );
        }

        const ac: AnalyzerChunk = {
            channelData: incoming,
            sampleRate: this.sampleRate,
            startSample: this.decodedSamples,
        };
        for (const a of this.analyzers) a.feed(ac);
        this.decodedSamples += frames;
    }

    finalize(): void {
        if (!this.initialized) return;
        for (const a of this.analyzers) a.finalize();
    }

    get totalSamples(): number {
        return this.decodedSamples;
    }

    get numChannelsObserved(): number {
        return this.numChannels;
    }

    get sampleRateObserved(): number {
        return this.sampleRate;
    }
}
