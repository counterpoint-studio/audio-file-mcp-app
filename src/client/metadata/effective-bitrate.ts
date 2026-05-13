export function computeEffectiveBitrate(
    sizeBytes: number,
    durationSeconds: number,
): number | undefined {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return undefined;
    return Math.round((sizeBytes * 8) / durationSeconds);
}

export function computeEstimatedDuration(
    sizeBytes: number,
    bitrateBps: number,
): number | undefined {
    if (!Number.isFinite(bitrateBps) || bitrateBps <= 0) return undefined;
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return undefined;
    return (sizeBytes * 8) / bitrateBps;
}
