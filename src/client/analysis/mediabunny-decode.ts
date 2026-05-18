import {
    Input,
    ALL_FORMATS,
    AudioSampleSink,
    type InputAudioTrack,
    type AudioSample,
    type Source,
} from "mediabunny";

export type DecodeChunk = {
    sampleRate: number;
    channelData: Float32Array[];
};

type InputLike = {
    getPrimaryAudioTrack(): Promise<InputAudioTrack | null>;
    dispose(): void;
};

type SinkLike = {
    samples(start?: number, end?: number): AsyncIterable<AudioSample>;
};

export type DecodeOptions = {
    onChunk: (chunk: DecodeChunk) => void;
    isAborted?: () => boolean;
    /**
     * If set, yields to the event loop (setTimeout(0)) when more than this
     * many milliseconds have elapsed since the last yield. Use on the main
     * thread to keep paint/input responsive; leave undefined in workers
     * where the host thread is dedicated.
     */
    yieldEveryMs?: number;
    /** Factory hook for tests. */
    inputFactory?: (source: Source) => InputLike;
    /** Factory hook for tests. */
    sinkFactory?: (track: InputAudioTrack) => SinkLike;
};

// Worker-safe decode: AudioSampleSink yields AudioSample (a wrapper around the
// WebCodecs AudioData primitive), which is available in DedicatedWorkerGlobalScope.
// AudioBufferSink, by contrast, constructs AudioBuffer objects which only
// exist on the main thread.
export async function decodeWithMediabunny(
    source: Source,
    opts: DecodeOptions,
): Promise<void> {
    const inputFactory =
        opts.inputFactory ??
        ((s: Source) => new Input({ formats: ALL_FORMATS, source: s }));
    const sinkFactory =
        opts.sinkFactory ?? ((t: InputAudioTrack) => new AudioSampleSink(t));

    const input = inputFactory(source);
    // Pool the channel buffers and the outer array. WebCodecs sample sizes are
    // typically stable per codec (AAC=1024, MP3=1152, Opus=20 ms multiples),
    // so after the first sample we usually reuse the same backing storage for
    // the whole decode. Analyzers consume `channelData` synchronously inside
    // `pipeline.feed()` and never retain references — verified by inspection
    // of frame-router/loudness/sample-stats/waveform-peaks/waveform-band-energy.
    let pool: Float32Array[] = [];
    let outerChannelData: Float32Array[] = [];
    const yieldEveryMs = opts.yieldEveryMs;
    let lastYieldAt = yieldEveryMs !== undefined ? performance.now() : 0;
    try {
        const track = await input.getPrimaryAudioTrack();
        if (!track) throw new Error("no audio track");
        if (opts.isAborted?.()) return;
        const sink = sinkFactory(track);
        for await (const sample of sink.samples()) {
            try {
                if (opts.isAborted?.()) return;
                const numCh = sample.numberOfChannels;
                const frames = sample.numberOfFrames;
                while (pool.length < numCh) pool.push(new Float32Array(0));
                if (outerChannelData.length !== numCh) {
                    outerChannelData = new Array(numCh);
                }
                for (let c = 0; c < numCh; c++) {
                    if (pool[c].length < frames) {
                        pool[c] = new Float32Array(frames);
                    }
                    const view =
                        pool[c].length === frames
                            ? pool[c]
                            : pool[c].subarray(0, frames);
                    sample.copyTo(view, {
                        planeIndex: c,
                        format: "f32-planar",
                    });
                    outerChannelData[c] = view;
                }
                opts.onChunk({
                    sampleRate: sample.sampleRate,
                    channelData: outerChannelData,
                });
            } finally {
                sample.close();
            }
            if (yieldEveryMs !== undefined) {
                const now = performance.now();
                if (now - lastYieldAt >= yieldEveryMs) {
                    await new Promise<void>((r) => setTimeout(r, 0));
                    lastYieldAt = performance.now();
                }
            }
        }
    } finally {
        try {
            input.dispose();
        } catch {
            // ignore
        }
    }
}
