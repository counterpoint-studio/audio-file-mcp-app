export function asScalar(v: string | string[] | undefined): string | null {
    if (Array.isArray(v)) return v.length > 0 ? v[0] : null;
    return v ?? null;
}

const INT_RE = /^\d+$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function parseNonNegInt(s: string | null): number | null {
    if (s === null || s.length === 0) return null;
    if (!INT_RE.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > MAX_SAFE) return null;
    return n;
}
