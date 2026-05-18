import { getInstance, instantiate } from "./dsp-loader";

type WasmModule = {
    HEAPF32: Float32Array;
    _pffft_new_setup(n: number, transform: number): number;
    _pffft_destroy_setup(setup: number): void;
    _pffft_aligned_malloc(n: number): number;
    _pffft_aligned_free(p: number): void;
    _pffft_transform_ordered(
        setup: number,
        input: number,
        output: number,
        work: number,
        direction: number,
    ): void;
};

const PFFFT_REAL = 0;
const PFFFT_FORWARD = 0;

export interface Fft {
    readonly size: number;
    forward(input: Float32Array, output: Float32Array): void;
    magnitudes(input: Float32Array): Float32Array;
    dispose(): void;
}

class PffftReal implements Fft {
    private mod: WasmModule;
    public readonly size: number;
    private setup = 0;
    private inPtr = 0;
    private outPtr = 0;
    private workPtr = 0;
    private mags: Float32Array;

    constructor(mod: WasmModule, size: number) {
        if (size < 32 || (size & (size - 1)) !== 0) {
            throw new Error(`PFFFT real size must be a power of 2 >= 32, got ${size}`);
        }
        this.mod = mod;
        this.size = size;
        this.setup = mod._pffft_new_setup(size, PFFFT_REAL);
        if (!this.setup) throw new Error(`pffft_new_setup(${size}, REAL) returned NULL`);
        const bytes = size * 4;
        this.inPtr = mod._pffft_aligned_malloc(bytes);
        this.outPtr = mod._pffft_aligned_malloc(bytes);
        this.workPtr = mod._pffft_aligned_malloc(bytes);
        if (!this.inPtr || !this.outPtr || !this.workPtr) {
            throw new Error("pffft_aligned_malloc failed");
        }
        this.mags = new Float32Array(size / 2);
    }

    forward(input: Float32Array, output: Float32Array): void {
        if (this.setup === 0) throw new Error("Fft disposed");
        if (input.length !== this.size) {
            throw new Error(`input length ${input.length} != fft size ${this.size}`);
        }
        if (output.length < this.size) {
            throw new Error(`output length ${output.length} < fft size ${this.size}`);
        }
        const mod = this.mod;
        const heap = mod.HEAPF32;
        const inOff = this.inPtr >> 2;
        const outOff = this.outPtr >> 2;
        heap.set(input, inOff);
        mod._pffft_transform_ordered(this.setup, this.inPtr, this.outPtr, this.workPtr, PFFFT_FORWARD);
        output.set(heap.subarray(outOff, outOff + this.size));
    }

    magnitudes(input: Float32Array): Float32Array {
        if (this.setup === 0) throw new Error("Fft disposed");
        if (input.length !== this.size) {
            throw new Error(`input length ${input.length} != fft size ${this.size}`);
        }
        const mod = this.mod;
        const heap = mod.HEAPF32;
        const inOff = this.inPtr >> 2;
        const outOff = this.outPtr >> 2;
        heap.set(input, inOff);
        mod._pffft_transform_ordered(this.setup, this.inPtr, this.outPtr, this.workPtr, PFFFT_FORWARD);
        const out = this.mags;
        const N = this.size;
        // PFFFT ordered real layout:
        //   out[0] = DC real
        //   out[1] = Nyquist real
        //   out[2k], out[2k+1] = bin k real/imag for k = 1 .. N/2 - 1
        out[0] = Math.abs(heap[outOff]);
        for (let k = 1; k < N / 2; k++) {
            const re = heap[outOff + 2 * k];
            const im = heap[outOff + 2 * k + 1];
            out[k] = Math.sqrt(re * re + im * im);
        }
        return out;
    }

    dispose(): void {
        if (this.setup === 0) return;
        const mod = this.mod;
        if (this.inPtr) mod._pffft_aligned_free(this.inPtr);
        if (this.outPtr) mod._pffft_aligned_free(this.outPtr);
        if (this.workPtr) mod._pffft_aligned_free(this.workPtr);
        mod._pffft_destroy_setup(this.setup);
        this.setup = 0;
        this.inPtr = 0;
        this.outPtr = 0;
        this.workPtr = 0;
    }
}

export function createFft(size: number): Fft {
    return new PffftReal(getInstance() as WasmModule, size);
}

export async function createFftAsync(size: number): Promise<Fft> {
    await instantiate();
    return createFft(size);
}
