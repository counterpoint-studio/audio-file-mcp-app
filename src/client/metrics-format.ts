export const PLACEHOLDER = "—";

export function formatDbFromLinear(linear: number): string {
    if (Number.isNaN(linear)) return PLACEHOLDER;
    if (!Number.isFinite(linear) || linear === 0) return "-∞ dB";
    return `${(20 * Math.log10(Math.abs(linear))).toFixed(1)} dB`;
}

export function formatDb(db: number): string {
    if (Number.isNaN(db)) return PLACEHOLDER;
    if (!Number.isFinite(db)) return "-∞ dB";
    return `${db.toFixed(1)} dB`;
}

export function formatCrest(
    samplePeakLinear: number,
    rmsLinear: number,
): string {
    if (
        !Number.isFinite(samplePeakLinear) ||
        !Number.isFinite(rmsLinear) ||
        samplePeakLinear === 0 ||
        rmsLinear === 0
    ) {
        return PLACEHOLDER;
    }
    const peakDb = 20 * Math.log10(samplePeakLinear);
    const rmsDb = 20 * Math.log10(rmsLinear);
    return `${(peakDb - rmsDb).toFixed(1)} dB`;
}

export function formatLufs(v: number): string {
    if (Number.isNaN(v)) return PLACEHOLDER;
    if (!Number.isFinite(v)) return "-∞ LUFS";
    return `${v.toFixed(1)} LUFS`;
}

export function formatLu(v: number): string {
    if (Number.isNaN(v)) return PLACEHOLDER;
    if (!Number.isFinite(v)) return "-∞ LU";
    return `${v.toFixed(1)} LU`;
}
