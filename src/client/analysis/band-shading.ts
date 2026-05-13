import type { BandEnergy } from "./waveform-band-energy";

export type Theme = "light" | "dark";

export interface WaveformPalette {
    rampDark: number;
    rampLight: number;
    fallback: string;
    placeholder: string;
}

const LIGHT_PALETTE: WaveformPalette = {
    rampDark: 0x1a,
    rampLight: 0xaa,
    fallback: "#111111",
    placeholder: "#bbbbbb",
};

const DARK_PALETTE: WaveformPalette = {
    rampDark: 0xe5,
    rampLight: 0x55,
    fallback: "#eeeeee",
    placeholder: "#444444",
};

export function waveformPalette(theme: Theme): WaveformPalette {
    return theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
}

export function bandEnergyToFillStyle(
    be: BandEnergy,
    palette: WaveformPalette = LIGHT_PALETTE,
): string {
    const total = be.low + be.mid + be.high;
    if (total <= 0) return palette.fallback;
    const centroid = (0 * be.low + 0.5 * be.mid + 1 * be.high) / total;
    const t = Math.max(0, Math.min(1, centroid));
    const v = Math.round(
        palette.rampDark + (palette.rampLight - palette.rampDark) * t,
    );
    const hex = v.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
}
