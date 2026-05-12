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
        }

        const channelData = this.normalizeChannels(incoming);
        const ac: AnalyzerChunk = {
            channelData,
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

    // Coerce a chunk's channel layout to the count we initialized with.
    // audio-decode collapses stereo→mono per chunk when L≡R at every 37th
    // sample (see audio-decode.js norm()), so a real stereo file can flicker
    // to 1ch on silent passages. We invert that here so loudness (which
    // requires a fixed channel count) keeps working.
    private normalizeChannels(channels: Float32Array[]): Float32Array[] {
        if (channels.length === this.numChannels) return channels;
        const out: Float32Array[] = new Array(this.numChannels);
        for (let c = 0; c < this.numChannels; c++) {
            out[c] = channels[c % channels.length];
        }
        return out;
    }
}
