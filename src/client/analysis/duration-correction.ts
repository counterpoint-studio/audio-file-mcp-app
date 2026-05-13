export const DURATION_TOLERANCE_S = 1e-3;

export function shouldApplyFinalDuration(
    initial: number | null,
    initialExact: boolean,
    actual: number,
    tolerance: number = DURATION_TOLERANCE_S,
): boolean {
    if (!Number.isFinite(actual) || actual <= 0) return false;
    if (initial === null) return true;
    if (!initialExact) return true;
    return Math.abs(actual - initial) > tolerance;
}
