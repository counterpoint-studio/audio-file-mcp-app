import type { Analyzer, AnalyzerChunk } from "./analyzer";

export const FFT_SIZE = 2048;
export const HOP = 1024;

export interface FrameConsumer {
    onFrame(window: Float32Array, frameIndex: number, sampleRate: number): void;
}

function makeHann(N: number): Float32Array {
    const w = new Float32Array(N);
    for (let n = 0; n < N; n++) {
        w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    }
    return w;
}

export class FrameRouter implements Analyzer {
    private readonly consumers: FrameConsumer[];
    private readonly hann: Float32Array;
    private readonly buffer = new Float32Array(FFT_SIZE);
    private readonly window = new Float32Array(FFT_SIZE);
    private bufferFill = 0;
    private frameIndex = 0;
    private sampleRate = 0;
    private firstFrameEmitted = false;

    constructor(consumers: FrameConsumer[]) {
        this.consumers = consumers;
        this.hann = makeHann(FFT_SIZE);
    }

    init(sampleRate: number): void {
        this.sampleRate = sampleRate;
        this.bufferFill = 0;
        this.frameIndex = 0;
        this.firstFrameEmitted = false;
    }

    feed(chunk: AnalyzerChunk): void {
        const channels = chunk.channelData;
        const nc = channels.length;
        if (nc === 0) return;
        const n = channels[0].length;
        if (n === 0) return;

        const buf = this.buffer;
        const inv = 1 / nc;

        for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let c = 0; c < nc; c++) sum += channels[c][i];
            buf[this.bufferFill++] = sum * inv;

            if (this.bufferFill === FFT_SIZE) {
                this.emitFrame();
                buf.copyWithin(0, HOP, FFT_SIZE);
                this.bufferFill = FFT_SIZE - HOP;
            }
        }
    }

    finalize(): void {
        // Intentionally do not zero-pad a partial trailing frame.
    }

    private emitFrame(): void {
        const buf = this.buffer;
        const w = this.window;
        const h = this.hann;
        for (let i = 0; i < FFT_SIZE; i++) w[i] = buf[i] * h[i];
        const idx = this.frameIndex++;
        this.firstFrameEmitted = true;
        for (const c of this.consumers) c.onFrame(w, idx, this.sampleRate);
    }
}
