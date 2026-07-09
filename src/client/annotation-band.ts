import type {
    AnnotationData,
    AnnotationLane,
    AnnotationSpan,
} from "../shared/annotation-data";
import { resolveLaneSpans, envelopeStops } from "./annotation-layout";

const SVG_NS = "http://www.w3.org/2000/svg";
const ROW_PAD = 0.15; // fraction of a row left blank above and below each span

export type AnnotationBand = {
    setDuration(duration: number): void;
    destroy(): void;
};

/**
 * Renders annotation lanes as an SVG strip normalized in time (viewBox width 1,
 * one unit of height per lane). x-positions need the audio duration, so the
 * geometry is (re)built the first time a positive finite duration is known and
 * again if the duration changes. Lane height is independent of duration, so the
 * band's height grows immediately via the `--annotation-lanes` custom property.
 */
export function createAnnotationBand(
    bandEl: HTMLElement,
    data: AnnotationData | null,
    duration: number,
): AnnotationBand {
    const lanes = data?.lanes ?? [];
    const nLanes = lanes.length;

    // Drives band/body height (see CSS). Set on :root so both `body { height }`
    // and `#annotation-band { height }` resolve the same value.
    document.documentElement.style.setProperty(
        "--annotation-lanes",
        String(nLanes),
    );
    bandEl.hidden = nLanes === 0;

    let builtDuration = 0;
    let label: HTMLDivElement | null = null;
    // Resolved (truncated/deduped) spans per lane, used for span-precise hover.
    let laneSpans: AnnotationSpan[][] = [];

    const build = (d: number): void => {
        if (nLanes === 0) return;
        if (!Number.isFinite(d) || d <= 0) return;
        builtDuration = d;
        laneSpans = [];
        bandEl.replaceChildren();

        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", `0 0 1 ${nLanes}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.classList.add("annotation-svg");

        const defs = document.createElementNS(SVG_NS, "defs");
        svg.appendChild(defs);

        lanes.forEach((lane, i) => {
            const fill = laneFillColor(lane);
            const stops = envelopeStops(lane.envelope, d);
            let rectFill: string;
            if (stops.length > 0) {
                const gradId = `annotation-lane-${i}-grad`;
                defs.appendChild(buildGradient(gradId, fill, stops));
                rectFill = `url(#${gradId})`;
            } else {
                rectFill = fill;
            }

            const spans = resolveLaneSpans(lane.spans);
            laneSpans[i] = spans;
            for (const span of spans) {
                const rect = document.createElementNS(SVG_NS, "rect");
                rect.setAttribute("x", String(span.start / d));
                rect.setAttribute("width", String((span.end - span.start) / d));
                rect.setAttribute("y", String(i + ROW_PAD));
                rect.setAttribute("height", String(1 - 2 * ROW_PAD));
                // Use CSS `fill` (not the presentation attribute) so `var()` and
                // `url()` values resolve.
                rect.style.fill = rectFill;
                svg.appendChild(rect);
            }
        });

        bandEl.appendChild(svg);

        label = document.createElement("div");
        label.className = "annotation-label";
        label.hidden = true;
        bandEl.appendChild(label);
    };

    const hideLabel = (): void => {
        if (label) label.hidden = true;
    };

    const onPointerMove = (e: PointerEvent): void => {
        // Never stopPropagation: seeking/region-drag listen on #seek-bar.
        if (nLanes === 0 || !label || builtDuration <= 0) return;
        const rect = bandEl.getBoundingClientRect();
        if (rect.height <= 0 || rect.width <= 0) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // The band is a thin strip; hide as soon as the cursor leaves its box on
        // either axis. Listening on the ancestor (rather than the band's own
        // pointerleave) makes vertical exit reliable.
        if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) {
            hideLabel();
            return;
        }
        const laneIndex = Math.floor((y / rect.height) * nLanes);
        const lane = lanes[laneIndex];
        // Show only when hovering an actual span (not the empty row) of a
        // labelled lane.
        const timeSec = (x / rect.width) * builtDuration;
        const overSpan = (laneSpans[laneIndex] ?? []).some(
            (s) => timeSec >= s.start && timeSec < s.end,
        );
        if (!lane || !lane.label || !overSpan) {
            hideLabel();
            return;
        }
        label.textContent = lane.label;
        label.hidden = false;
        const maxLeft = Math.max(0, rect.width - label.offsetWidth);
        label.style.left = `${Math.min(Math.max(0, x), maxLeft)}px`;
    };

    // Listen on the seek-bar ancestor: its children (waveform, band,
    // spectrogram) bubble pointer moves up, so a single handler tracks the
    // cursor across the whole strip and hides the label the moment it leaves the
    // band's box — including vertically. Also hide on leave/gesture-start/cancel
    // (during a seek the seek-bar captures the pointer, so moves stop arriving).
    const surface: HTMLElement =
        bandEl.closest<HTMLElement>("#seek-bar") ??
        bandEl.parentElement ??
        bandEl;
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerleave", hideLabel);
    surface.addEventListener("pointerdown", hideLabel);
    surface.addEventListener("pointercancel", hideLabel);

    build(duration);

    return {
        setDuration(d: number): void {
            if (!Number.isFinite(d) || d <= 0) return;
            if (d === builtDuration) return;
            build(d);
        },
        destroy(): void {
            surface.removeEventListener("pointermove", onPointerMove);
            surface.removeEventListener("pointerleave", hideLabel);
            surface.removeEventListener("pointerdown", hideLabel);
            surface.removeEventListener("pointercancel", hideLabel);
            bandEl.replaceChildren();
            bandEl.hidden = true;
            label = null;
            document.documentElement.style.removeProperty("--annotation-lanes");
        },
    };
}

function buildGradient(
    id: string,
    fill: string,
    stops: { offset: number; opacity: number }[],
): SVGLinearGradientElement {
    const grad = document.createElementNS(
        SVG_NS,
        "linearGradient",
    ) as SVGLinearGradientElement;
    grad.setAttribute("id", id);
    // Span the full time axis in user space so each rect samples its sub-range.
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", "0");
    grad.setAttribute("x2", "1");
    grad.setAttribute("y1", "0");
    grad.setAttribute("y2", "0");
    for (const stop of stops) {
        const el = document.createElementNS(SVG_NS, "stop");
        el.setAttribute("offset", String(stop.offset));
        // Use CSS properties so a `var()` fill resolves.
        el.style.stopColor = fill;
        el.style.stopOpacity = String(stop.opacity);
        grad.appendChild(el);
    }
    return grad;
}

// Colored lanes use their (sanitized) color; uncolored lanes fall back to the
// light-accent CSS variable defined on #annotation-band.
function laneFillColor(lane: AnnotationLane): string {
    const sanitized = sanitizeColor(lane.color);
    return sanitized ?? "var(--annotation-fill)";
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const NAMED_RE = /^[a-zA-Z]+$/;
const FUNC_RE = /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/;

export function sanitizeColor(color: string | undefined): string | null {
    if (!color) return null;
    const c = color.trim();
    if (HEX_RE.test(c) || NAMED_RE.test(c) || FUNC_RE.test(c)) {
        return c;
    }
    return null;
}
