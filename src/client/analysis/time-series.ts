export const TIMESERIES_HZ = 10;
export const STEP_MS = 1000 / TIMESERIES_HZ;

export type TimeSeriesColumn =
    | "samplePeak"
    | "rms"
    | "truePeak"
    | "momentary"
    | "shortTerm";

export class TimeSeriesStore {
    samplePeak: Float32Array;
    rms: Float32Array;
    truePeak: Float32Array;
    momentary: Float32Array;
    shortTerm: Float32Array;
    clipping: Uint32Array;
    count = 0;

    constructor(initialSteps = 600) {
        const cap = Math.max(2, initialSteps);
        this.samplePeak = new Float32Array(cap);
        this.rms = new Float32Array(cap);
        this.truePeak = new Float32Array(cap);
        this.momentary = new Float32Array(cap);
        this.shortTerm = new Float32Array(cap);
        this.clipping = new Uint32Array(cap);
    }

    append(samplePeak: number, rms: number, clipping: number): void {
        if (this.count >= this.samplePeak.length) this.grow();
        this.samplePeak[this.count] = samplePeak;
        this.rms[this.count] = rms;
        this.truePeak[this.count] = NaN;
        this.momentary[this.count] = NaN;
        this.shortTerm[this.count] = NaN;
        this.clipping[this.count] = clipping;
        this.count++;
    }

    setAt(idx: number, key: TimeSeriesColumn, value: number): void {
        this[key][idx] = value;
    }

    indexAtSeconds(seconds: number): number {
        if (this.count === 0) return -1;
        return Math.max(
            0,
            Math.min(this.count - 1, Math.floor(seconds * TIMESERIES_HZ)),
        );
    }

    private grow(): void {
        const nextLen = this.samplePeak.length * 2;
        this.samplePeak = growFloat32(this.samplePeak, nextLen);
        this.rms = growFloat32(this.rms, nextLen);
        this.truePeak = growFloat32(this.truePeak, nextLen);
        this.momentary = growFloat32(this.momentary, nextLen);
        this.shortTerm = growFloat32(this.shortTerm, nextLen);
        const nextClipping = new Uint32Array(nextLen);
        nextClipping.set(this.clipping);
        this.clipping = nextClipping;
    }
}

function growFloat32(prev: Float32Array, nextLen: number): Float32Array {
    const next = new Float32Array(nextLen);
    next.set(prev);
    return next;
}
