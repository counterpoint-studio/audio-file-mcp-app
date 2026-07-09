import type { AnnotationSpan, AnnotationData } from "../shared/annotation-data";

// Sort by start; drop spans with a duplicate start (keep first); truncate each
// span's end down to the next span's start so rows never overlap. Also drops
// zero/negative-length spans after truncation.
export function resolveLaneSpans(spans: AnnotationSpan[]): AnnotationSpan[] {
    // Sort ascending by start. (Stable so duplicate-start dedup keeps the
    // first-encountered input order among equal starts.)
    const sorted = [...spans].sort((a, b) => a.start - b.start);

    // Drop spans whose start duplicates one already kept.
    const deduped: AnnotationSpan[] = [];
    let lastStart = Number.NaN;
    for (const span of sorted) {
        if (span.start === lastStart) continue;
        deduped.push(span);
        lastStart = span.start;
    }

    // Truncate each span's end down to the next span's start, then drop any
    // span whose resulting length is zero or negative.
    const result: AnnotationSpan[] = [];
    for (let i = 0; i < deduped.length; i++) {
        const span = deduped[i];
        const next = deduped[i + 1];
        const end = next ? Math.min(span.end, next.start) : span.end;
        if (end > span.start) {
            result.push({ start: span.start, end });
        }
    }
    return result;
}

// Envelope → sorted stops normalized to [0,1] offset over `duration`, opacity
// clamped to [0,1]. Times outside [0,duration] are clamped; empty/absent → [].
export function envelopeStops(
    envelope: { time: number; value: number }[] | undefined,
    duration: number,
): { offset: number; opacity: number }[] {
    if (!envelope || envelope.length === 0) return [];
    if (!Number.isFinite(duration) || duration <= 0) return [];
    return envelope
        .map((p) => ({
            offset: clamp01(p.time / duration),
            opacity: clamp01(p.value),
        }))
        .sort((a, b) => a.offset - b.offset);
}

// A lane is active if any resolved span covers `timeSec` (half-open [start,end)).
export function activeLaneIndicesAt(
    data: AnnotationData,
    timeSec: number,
): number[] {
    const indices: number[] = [];
    data.lanes.forEach((lane, i) => {
        const spans = resolveLaneSpans(lane.spans);
        if (spans.some((s) => timeSec >= s.start && timeSec < s.end)) {
            indices.push(i);
        }
    });
    return indices;
}

// active = any resolved span overlaps [startSec,endSec] (inclusive);
// starting = a span's start ∈ [startSec,endSec];
// ending = a span's end ∈ [startSec,endSec].
export function laneActivityInRegion(
    data: AnnotationData,
    startSec: number,
    endSec: number,
): { active: number[]; starting: number[]; ending: number[] } {
    const lo = Math.min(startSec, endSec);
    const hi = Math.max(startSec, endSec);
    const active: number[] = [];
    const starting: number[] = [];
    const ending: number[] = [];
    data.lanes.forEach((lane, i) => {
        const spans = resolveLaneSpans(lane.spans);
        if (spans.some((s) => s.start <= hi && s.end >= lo)) {
            active.push(i);
        }
        if (spans.some((s) => s.start >= lo && s.start <= hi)) {
            starting.push(i);
        }
        if (spans.some((s) => s.end >= lo && s.end <= hi)) {
            ending.push(i);
        }
    });
    return { active, starting, ending };
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}
