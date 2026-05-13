import { FFT_SIZE } from "./frame-router";

export const GRID_FREQUENCIES_HZ = [100, 1_000, 10_000] as const;

export function formatGridLabel(hz: number): string {
    if (hz >= 1_000) return `${hz / 1_000}kHz`;
    return `${hz}Hz`;
}

export function frequencyRange(
    sampleRate: number,
): { minHz: number; maxHz: number } | null {
    if (sampleRate <= 0) return null;
    const minHz = Math.max(20, sampleRate / FFT_SIZE);
    const maxHz = sampleRate / 2;
    if (!(maxHz > minHz)) return null;
    return { minHz, maxHz };
}

export function frequencyToY(
    hz: number,
    cssHeight: number,
    sampleRate: number,
): number | null {
    const range = frequencyRange(sampleRate);
    if (!range) return null;
    if (hz < range.minHz || hz > range.maxHz) return null;
    const t =
        (Math.log(hz) - Math.log(range.minHz)) /
        (Math.log(range.maxHz) - Math.log(range.minHz));
    return cssHeight * (1 - t);
}

export function visibleGridFrequencies(sampleRate: number): readonly number[] {
    return GRID_FREQUENCIES_HZ.filter(
        (hz) => frequencyToY(hz, 1, sampleRate) !== null,
    );
}
