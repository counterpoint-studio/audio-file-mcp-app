import { getInstance, instantiate } from "./wasm-dsp.gen";

type WasmModule = {
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;
    HEAPU32: Uint32Array;
    _malloc(n: number): number;
    _free(p: number): void;
    _ebur128_init(channels: number, samplerate: number, mode: number): number;
    _ebur128_destroy(stPtrPtr: number): void;
    _ebur128_add_frames_float(st: number, src: number, frames: number): number;
    _ebur128_loudness_global(st: number, outPtr: number): number;
    _ebur128_loudness_momentary(st: number, outPtr: number): number;
    _ebur128_loudness_shortterm(st: number, outPtr: number): number;
    _ebur128_loudness_range(st: number, outPtr: number): number;
    _ebur128_sample_peak(st: number, ch: number, outPtr: number): number;
    _ebur128_true_peak(st: number, ch: number, outPtr: number): number;
};

// EBUR128_MODE_* values from vendor/libebur128/ebur128.h.
const EBUR128_MODE_M = 1;
const EBUR128_MODE_S = (1 << 1) | EBUR128_MODE_M;
const EBUR128_MODE_I = (1 << 2) | EBUR128_MODE_M;
const EBUR128_MODE_LRA = (1 << 3) | EBUR128_MODE_S;
const EBUR128_MODE_SAMPLE_PEAK = (1 << 4) | EBUR128_MODE_M;
const EBUR128_MODE_TRUE_PEAK = (1 << 5) | EBUR128_MODE_M | EBUR128_MODE_SAMPLE_PEAK;

export type LoudnessMode = string;

function parseMode(mode: LoudnessMode): number {
    let bits = 0;
    for (const part of mode.split("|").map(s => s.trim()).filter(Boolean)) {
        switch (part) {
            case "M": bits |= EBUR128_MODE_M; break;
            case "S": bits |= EBUR128_MODE_S; break;
            case "I": bits |= EBUR128_MODE_I; break;
            case "LRA": bits |= EBUR128_MODE_LRA; break;
            case "SP": bits |= EBUR128_MODE_SAMPLE_PEAK; break;
            case "TP": bits |= EBUR128_MODE_TRUE_PEAK; break;
            default: throw new Error(`unknown loudness mode token "${part}"`);
        }
    }
    return bits;
}

export interface Loudness {
    addFrames(channels: Float32Array[]): void;
    momentary(): number;
    shortterm(): number;
    global(): number;
    range(): number;
    samplePeak(): number;
    truePeak(): number;
    dispose(): void;
}

function linToDb(linear: number): number {
    if (!(linear > 0)) return -Infinity;
    return 20 * Math.log10(linear);
}

class Ebur128Loudness implements Loudness {
    private mod: WasmModule;
    private state: number;
    private readonly channels: number;
    private outDoublePtr: number;
    private interleaveBytes = 0;
    private interleavePtr = 0;

    constructor(mod: WasmModule, sampleRate: number, channels: number, mode: number) {
        this.mod = mod;
        this.channels = channels;
        this.state = mod._ebur128_init(channels, sampleRate, mode);
        if (!this.state) throw new Error("ebur128_init returned NULL");
        this.outDoublePtr = mod._malloc(8);
        if (!this.outDoublePtr) {
            mod._ebur128_destroy(this.state);
            this.state = 0;
            throw new Error("ebur128 _malloc(8) failed");
        }
    }

    private ensureInterleaveBuffer(frames: number): void {
        const needed = frames * this.channels * 4;
        if (needed <= this.interleaveBytes) return;
        if (this.interleavePtr) this.mod._free(this.interleavePtr);
        const ptr = this.mod._malloc(needed);
        if (!ptr) throw new Error(`ebur128 interleave buffer _malloc(${needed}) failed`);
        this.interleavePtr = ptr;
        this.interleaveBytes = needed;
    }

    addFrames(channels: Float32Array[]): void {
        if (!this.state) throw new Error("Loudness disposed");
        if (channels.length !== this.channels) {
            throw new Error(`expected ${this.channels} channels, got ${channels.length}`);
        }
        const frames = channels[0]?.length ?? 0;
        if (frames === 0) return;
        for (let c = 1; c < channels.length; c++) {
            if (channels[c].length !== frames) {
                throw new Error("channel lengths must match");
            }
        }
        this.ensureInterleaveBuffer(frames);
        const heap = this.mod.HEAPF32;
        const off = this.interleavePtr >> 2;
        const nc = this.channels;
        for (let i = 0; i < frames; i++) {
            for (let c = 0; c < nc; c++) {
                heap[off + i * nc + c] = channels[c][i];
            }
        }
        const rc = this.mod._ebur128_add_frames_float(this.state, this.interleavePtr, frames);
        if (rc !== 0) throw new Error(`ebur128_add_frames_float returned ${rc}`);
    }

    private readDoubleGetter(fn: (st: number, outPtr: number) => number): number {
        if (!this.state) throw new Error("Loudness disposed");
        const rc = fn.call(this.mod, this.state, this.outDoublePtr);
        if (rc !== 0) return NaN;
        return this.mod.HEAPF64[this.outDoublePtr >> 3];
    }

    momentary(): number {
        return this.readDoubleGetter(this.mod._ebur128_loudness_momentary);
    }
    shortterm(): number {
        return this.readDoubleGetter(this.mod._ebur128_loudness_shortterm);
    }
    global(): number {
        return this.readDoubleGetter(this.mod._ebur128_loudness_global);
    }
    range(): number {
        return this.readDoubleGetter(this.mod._ebur128_loudness_range);
    }

    private maxPeakDb(
        fn: (st: number, ch: number, outPtr: number) => number,
    ): number {
        if (!this.state) throw new Error("Loudness disposed");
        let maxLin = 0;
        for (let c = 0; c < this.channels; c++) {
            const rc = fn.call(this.mod, this.state, c, this.outDoublePtr);
            if (rc !== 0) return NaN;
            const v = this.mod.HEAPF64[this.outDoublePtr >> 3];
            if (v > maxLin) maxLin = v;
        }
        return linToDb(maxLin);
    }

    samplePeak(): number {
        return this.maxPeakDb(this.mod._ebur128_sample_peak);
    }
    truePeak(): number {
        return this.maxPeakDb(this.mod._ebur128_true_peak);
    }

    dispose(): void {
        if (!this.state) return;
        // ebur128_destroy takes a pointer to the state pointer. Allocate one
        // slot, write the state pointer there, call destroy, then free the slot.
        const slot = this.mod._malloc(4);
        if (slot) {
            this.mod.HEAPU32[slot >> 2] = this.state;
            this.mod._ebur128_destroy(slot);
            this.mod._free(slot);
        }
        this.state = 0;
        if (this.outDoublePtr) {
            this.mod._free(this.outDoublePtr);
            this.outDoublePtr = 0;
        }
        if (this.interleavePtr) {
            this.mod._free(this.interleavePtr);
            this.interleavePtr = 0;
            this.interleaveBytes = 0;
        }
    }
}

export function createLoudness(
    sampleRate: number,
    channels: number,
    mode: LoudnessMode,
): Loudness {
    return new Ebur128Loudness(
        getInstance() as WasmModule,
        sampleRate,
        channels,
        parseMode(mode),
    );
}

export async function createLoudnessAsync(
    sampleRate: number,
    channels: number,
    mode: LoudnessMode,
): Promise<Loudness> {
    await instantiate();
    return createLoudness(sampleRate, channels, mode);
}
