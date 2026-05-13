import type { BandEnergy } from "./waveform-band-energy";

const DARK = 0x1a;
const LIGHT = 0xaa;

export function bandEnergyToFillStyle(be: BandEnergy): string {
    const total = be.low + be.mid + be.high;
    if (total <= 0) return "#111";
    const centroid = (0 * be.low + 0.5 * be.mid + 1 * be.high) / total;
    const t = Math.max(0, Math.min(1, centroid));
    const v = Math.round(DARK + (LIGHT - DARK) * t);
    const hex = v.toString(16).padStart(2, "0");
    return `#${hex}${hex}${hex}`;
}
