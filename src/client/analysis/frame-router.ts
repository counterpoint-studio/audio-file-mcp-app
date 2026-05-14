import type { Analyzer, AnalyzerChunk } from "./analyzer";

export const FFT_SIZE = 2048;
export const HOP = 1024;

export interface FrameConsumer {
    // Frame is the raw (unwindowed) mono ring-buffer. Consumers must read it
    // synchronously: the buffer is reused across frames and not retained.
    onFrame(frame: Float32Array, frameIndex: number, sampleRate: number): void;
}

export class FrameRouter implements Analyzer {
    private readonly consumers: FrameConsumer[];
    private readonly buffer = new Float32Array(FFT_SIZE);
    private bufferFill = 0;
    private frameIndex = 0;
    private sampleRate = 0;

    constructor(consumers: FrameConsumer[]) {
        this.consumers = consumers;
    }

    init(sampleRate: number): void {
        this.sampleRate = sampleRate;
        this.bufferFill = 0;
        this.frameIndex = 0;
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
        const idx = this.frameIndex++;
        for (const c of this.consumers) c.onFrame(buf, idx, this.sampleRate);
    }
}
