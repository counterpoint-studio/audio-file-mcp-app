export type AnalyzerChunk = {
    channelData: Float32Array[];
    sampleRate: number;
    /** Global sample index of the first sample in this chunk. */
    startSample: number;
};

export interface Analyzer {
    /** Called once per analysis run, after sampleRate is known. */
    init(sampleRate: number, numChannels: number): void;
    /** Called for each decoded chunk. */
    feed(chunk: AnalyzerChunk): void;
    /** Called after the last chunk. */
    finalize(): void;
}
