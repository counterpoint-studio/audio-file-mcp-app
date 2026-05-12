export class GrowablePeaks {
    private buf: Float32Array;
    count = 0;
    constructor(initialBuckets: number) {
        this.buf = new Float32Array(Math.max(2, initialBuckets) * 2);
    }
    append(min: number, max: number): void {
        if ((this.count + 1) * 2 > this.buf.length) {
            const next = new Float32Array(this.buf.length * 2);
            next.set(this.buf);
            this.buf = next;
        }
        this.buf[this.count * 2] = min;
        this.buf[this.count * 2 + 1] = max;
        this.count++;
    }
    minAt(i: number): number {
        return this.buf[i * 2];
    }
    maxAt(i: number): number {
        return this.buf[i * 2 + 1];
    }
}
