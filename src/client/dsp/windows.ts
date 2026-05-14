// Window-function helpers used by spectrogram-style analyzers.
//
// `makeHann(N)` returns the symmetric Hann window of length N:
//   w[n] = 0.5 * (1 - cos(2π n / (N - 1)))
//
// Reassignment (see plan 2026-05-14) needs two additional windows:
//   - `makeHannTimeWeighted(N)`: t·h(t), centred about n0 = (N-1)/2
//   - `makeHannDerivative(N)`:   dh(t)/dn, the analytic derivative at samples

export function makeHann(N: number): Float32Array {
    const w = new Float32Array(N);
    if (N <= 0) return w;
    if (N === 1) {
        w[0] = 1;
        return w;
    }
    const denom = N - 1;
    for (let n = 0; n < N; n++) {
        w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / denom));
    }
    return w;
}

export function multiplyInto(
    src: Float32Array,
    win: Float32Array,
    out: Float32Array,
): void {
    const n = src.length;
    if (win.length !== n || out.length !== n) {
        throw new Error(
            `multiplyInto: length mismatch src=${n} win=${win.length} out=${out.length}`,
        );
    }
    for (let i = 0; i < n; i++) out[i] = src[i] * win[i];
}
