import {
    PLACEHOLDER,
    formatDb,
    formatDbFromLinear,
} from "./metrics-format";
import { formatTime } from "./time-display";

export type LiveMetrics = {
    samplePeak: number;
    rms: number;
    truePeak: number;
    momentary: number;
    shortTerm: number;
    integrated: number;
    lra: number;
    clipping: number;
};

export type SampleValues = {
    samplePeak: number;
    rms: number;
    truePeak: number;
    momentary: number;
    shortTerm: number;
    clipping: number;
} | null;

export type Metrics = { destroy(): void };

type GlobalCells = {
    samplePeak: HTMLElement;
    truePeak: HTMLElement;
    rms: HTMLElement;
    integrated: HTMLElement;
};

type SampleCells = {
    time: HTMLElement;
    peak: HTMLElement;
    rms: HTMLElement;
};

export function createMetrics(
    worker: Worker,
    seekBarEl: HTMLElement,
    audio: HTMLAudioElement,
): Metrics {
    const globalCells = readGlobalCells();
    const sampleCells = readSampleCells();
    const samplesPanel = requireEl("#stats-sample");

    resetGlobal(globalCells);
    resetSample(sampleCells);
    samplesPanel.hidden = true;

    let nextQueryId = 1;
    let pendingQueryId = 0;

    const onMessage = (e: MessageEvent) => {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "live-metrics" || data.type === "final-metrics") {
            renderGlobal(globalCells, data.metrics as LiveMetrics);
        } else if (data.type === "query-result") {
            if (data.id !== pendingQueryId) return;
            renderSample(sampleCells, data.values as SampleValues);
        }
    };
    worker.addEventListener("message", onMessage);

    const onPointerMove = (e: PointerEvent) => {
        const rect = seekBarEl.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = e.clientX - rect.left;
        const t = Math.max(0, Math.min(1, x / rect.width));
        const duration = audio.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
            samplesPanel.hidden = true;
            return;
        }
        const seconds = t * duration;
        samplesPanel.hidden = false;
        sampleCells.time.textContent = formatTime(seconds);
        pendingQueryId = nextQueryId++;
        worker.postMessage({
            type: "queryAt",
            id: pendingQueryId,
            seconds,
        });
    };

    const onPointerLeave = () => {
        samplesPanel.hidden = true;
        pendingQueryId = 0;
    };

    seekBarEl.addEventListener("pointermove", onPointerMove);
    seekBarEl.addEventListener("pointerleave", onPointerLeave);

    return {
        destroy() {
            worker.removeEventListener("message", onMessage);
            seekBarEl.removeEventListener("pointermove", onPointerMove);
            seekBarEl.removeEventListener("pointerleave", onPointerLeave);
            samplesPanel.hidden = true;
            resetGlobal(globalCells);
            resetSample(sampleCells);
        },
    };
}

function readGlobalCells(): GlobalCells {
    return {
        samplePeak: requireEl("#m-samplepeak"),
        truePeak: requireEl("#m-truepeak"),
        rms: requireEl("#m-rms"),
        integrated: requireEl("#m-i"),
    };
}

function readSampleCells(): SampleCells {
    return {
        time: requireEl("#s-time"),
        peak: requireEl("#s-peak"),
        rms: requireEl("#s-rms"),
    };
}

function requireEl(sel: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`metrics: missing ${sel}`);
    return el;
}

function resetGlobal(c: GlobalCells): void {
    c.samplePeak.textContent = PLACEHOLDER;
    c.truePeak.textContent = PLACEHOLDER;
    c.rms.textContent = PLACEHOLDER;
    c.integrated.textContent = PLACEHOLDER;
}

function resetSample(c: SampleCells): void {
    c.time.textContent = formatTime(0);
    c.peak.textContent = PLACEHOLDER;
    c.rms.textContent = PLACEHOLDER;
}

function renderGlobal(c: GlobalCells, m: LiveMetrics): void {
    c.samplePeak.textContent = formatDbFromLinear(m.samplePeak);
    c.truePeak.textContent = formatDb(m.truePeak);
    c.rms.textContent = formatDbFromLinear(m.rms);
    c.integrated.textContent = formatLufsValue(m.integrated);
}

function renderSample(c: SampleCells, v: SampleValues): void {
    if (!v) {
        c.peak.textContent = PLACEHOLDER;
        c.rms.textContent = PLACEHOLDER;
        return;
    }
    c.peak.textContent = compactDbFromLinear(v.samplePeak);
    c.rms.textContent = compactDbFromLinear(v.rms);
}

function formatLufsValue(v: number): string {
    if (Number.isNaN(v)) return PLACEHOLDER;
    if (!Number.isFinite(v)) return "-∞";
    return v.toFixed(1);
}

function compactDbFromLinear(linear: number): string {
    if (Number.isNaN(linear)) return PLACEHOLDER;
    if (!Number.isFinite(linear) || linear === 0) return "-∞dB";
    return `${(20 * Math.log10(Math.abs(linear))).toFixed(1)}dB`;
}
