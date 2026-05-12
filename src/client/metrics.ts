import {
    PLACEHOLDER,
    formatCrest,
    formatDb,
    formatDbFromLinear,
    formatLu,
    formatLufs,
} from "./metrics-format";

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

export type TooltipValues = {
    samplePeak: number;
    rms: number;
    truePeak: number;
    momentary: number;
    shortTerm: number;
    clipping: number;
} | null;

export type Metrics = { destroy(): void };

type Cells = {
    samplePeak: HTMLElement;
    truePeak: HTMLElement;
    rms: HTMLElement;
    crest: HTMLElement;
    clipping: HTMLElement;
    integrated: HTMLElement;
    lra: HTMLElement;
};

export function createMetrics(
    worker: Worker,
    seekBarEl: HTMLElement,
    audio: HTMLAudioElement,
): Metrics {
    const cells = readCells();
    const tooltip = document.querySelector<HTMLDivElement>("#metric-tooltip");
    if (!tooltip) throw new Error("#metric-tooltip missing");

    resetCells(cells);
    tooltip.hidden = true;

    let nextQueryId = 1;
    let pendingQueryId = 0;

    const onMessage = (e: MessageEvent) => {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "live-metrics" || data.type === "final-metrics") {
            renderCells(cells, data.metrics as LiveMetrics);
        } else if (data.type === "query-result") {
            if (data.id !== pendingQueryId) return;
            renderTooltip(tooltip, data.values as TooltipValues);
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
            tooltip.hidden = true;
            return;
        }
        tooltip.hidden = false;
        // Position within seek-stack (the tooltip's offsetParent); seek-bar
        // is the only horizontally-stretched flex child, so x relative to the
        // seek-bar matches x relative to the stack.
        const halfW = tooltip.offsetWidth / 2;
        const stackWidth = tooltip.offsetParent?.clientWidth ?? rect.width;
        const clampedX = Math.max(halfW, Math.min(stackWidth - halfW, x));
        tooltip.style.left = `${clampedX}px`;
        tooltip.style.top = `${seekBarEl.offsetTop}px`;
        pendingQueryId = nextQueryId++;
        worker.postMessage({
            type: "queryAt",
            id: pendingQueryId,
            seconds: t * duration,
        });
    };

    const onPointerLeave = () => {
        tooltip.hidden = true;
        pendingQueryId = 0;
    };

    seekBarEl.addEventListener("pointermove", onPointerMove);
    seekBarEl.addEventListener("pointerleave", onPointerLeave);

    return {
        destroy() {
            worker.removeEventListener("message", onMessage);
            seekBarEl.removeEventListener("pointermove", onPointerMove);
            seekBarEl.removeEventListener("pointerleave", onPointerLeave);
            tooltip.hidden = true;
            tooltip.textContent = "";
            resetCells(cells);
        },
    };
}

function readCells(): Cells {
    return {
        samplePeak: requireEl("#m-samplepeak"),
        truePeak: requireEl("#m-truepeak"),
        rms: requireEl("#m-rms"),
        crest: requireEl("#m-crest"),
        clipping: requireEl("#m-clipping"),
        integrated: requireEl("#m-i"),
        lra: requireEl("#m-lra"),
    };
}

function requireEl(sel: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`metrics: missing ${sel}`);
    return el;
}

function resetCells(c: Cells): void {
    c.samplePeak.textContent = PLACEHOLDER;
    c.truePeak.textContent = PLACEHOLDER;
    c.rms.textContent = PLACEHOLDER;
    c.crest.textContent = PLACEHOLDER;
    c.clipping.textContent = PLACEHOLDER;
    c.integrated.textContent = PLACEHOLDER;
    c.lra.textContent = PLACEHOLDER;
}

function renderCells(c: Cells, m: LiveMetrics): void {
    c.samplePeak.textContent = formatDbFromLinear(m.samplePeak);
    c.truePeak.textContent = formatDb(m.truePeak);
    c.rms.textContent = formatDbFromLinear(m.rms);
    c.crest.textContent = formatCrest(m.samplePeak, m.rms);
    c.clipping.textContent = Number.isFinite(m.clipping) ? String(m.clipping) : PLACEHOLDER;
    c.integrated.textContent = formatLufs(m.integrated);
    c.lra.textContent = formatLu(m.lra);
}

function renderTooltip(el: HTMLDivElement, v: TooltipValues): void {
    if (!v) {
        el.textContent = PLACEHOLDER;
        return;
    }
    const lines = [
        `peak ${formatDbFromLinear(v.samplePeak)}`,
        `rms  ${formatDbFromLinear(v.rms)}`,
        `M    ${formatDb(v.momentary)}`,
        `S    ${formatDb(v.shortTerm)}`,
        `clip ${v.clipping}`,
    ];
    el.textContent = lines.join("\n");
}

