import WaveformWorker from "./analysis-worker.ts?worker&inline";
import { type AudioFormat } from "./audio-formats";
import { getTheme, subscribeTheme } from "./theme";
import type { ChunkStore } from "./chunk-store";
import type { ChunkBus, ChunkEvent } from "./chunk-bus";
import type { ChunkLoader } from "./chunk-loader";

export type Waveform = { destroy(): void; worker: Worker };

export function createWaveform(
    chunkStore: ChunkStore,
    chunkBus: ChunkBus,
    loader: Pick<ChunkLoader, "request">,
    format: AudioFormat | null,
    seekBarEl: HTMLElement,
    durationSeconds: number | null,
    durationExact: boolean,
): Waveform {
    // transferControlToOffscreen can only be called once per HTMLCanvasElement.
    // Replace the existing #waveform with a fresh canvas so subsequent loads
    // don't hit InvalidStateError on the second transfer.
    const oldCanvas = seekBarEl.querySelector<HTMLCanvasElement>("#waveform");
    if (!oldCanvas) throw new Error("#waveform canvas missing");
    const canvas = document.createElement("canvas");
    canvas.id = "waveform";
    oldCanvas.replaceWith(canvas);

    const worker = new WaveformWorker();
    const offscreen = canvas.transferControlToOffscreen();
    const initSize = canvas.getBoundingClientRect();
    worker.postMessage(
        {
            type: "init",
            canvas: offscreen,
            cssWidth: initSize.width,
            cssHeight: initSize.height,
            dpr: window.devicePixelRatio,
            sizeBytes: chunkStore.totalSize,
            format,
            durationSeconds,
            durationExact,
            theme: getTheme(),
        },
        [offscreen],
    );

    // Forward already-loaded chunks at init time, then each subsequent arrival
    // via the chunk bus.
    const total = chunkStore.totalSize;
    const gaps = chunkStore.gaps(0, total);
    let cursor = 0;
    for (const [gs, ge] of gaps) {
        if (cursor < gs) postRange(cursor, gs);
        cursor = ge;
    }
    if (cursor < total) postRange(cursor, total);

    async function postRange(start: number, end: number): Promise<void> {
        const bytes = await chunkStore.read(start, end);
        worker.postMessage({
            type: "chunk",
            start,
            blob: new Blob([bytes as BlobPart]),
        });
    }

    const unsubscribeBus = chunkBus.subscribe((ev?: ChunkEvent) => {
        if (!ev) return;
        worker.postMessage({ type: "chunk", start: ev.start, blob: ev.blob });
    });

    const onWorkerMessage = (e: MessageEvent) => {
        const data = e.data;
        if (data && data.type === "request-range") {
            loader.request(data.start as number, data.end as number);
        }
    };
    worker.addEventListener("message", onWorkerMessage);

    const unsubscribeTheme = subscribeTheme((t) =>
        worker.postMessage({ type: "theme", theme: t }),
    );

    let pendingResizeRaf = 0;
    const ro = new ResizeObserver(() => {
        if (pendingResizeRaf !== 0) return;
        pendingResizeRaf = requestAnimationFrame(() => {
            pendingResizeRaf = 0;
            const r = canvas.getBoundingClientRect();
            worker.postMessage({
                type: "resize",
                cssWidth: r.width,
                cssHeight: r.height,
                dpr: window.devicePixelRatio,
            });
        });
    });
    ro.observe(canvas);

    let dprMql: MediaQueryList | null = null;
    const onDprChange = () => {
        const r = canvas.getBoundingClientRect();
        worker.postMessage({
            type: "resize",
            cssWidth: r.width,
            cssHeight: r.height,
            dpr: window.devicePixelRatio,
        });
        watchDpr();
    };
    const watchDpr = () => {
        dprMql?.removeEventListener("change", onDprChange);
        dprMql = window.matchMedia(
            `(resolution: ${window.devicePixelRatio}dppx)`,
        );
        dprMql.addEventListener("change", onDprChange);
    };
    watchDpr();

    return {
        worker,
        destroy() {
            ro.disconnect();
            if (pendingResizeRaf !== 0) {
                cancelAnimationFrame(pendingResizeRaf);
                pendingResizeRaf = 0;
            }
            dprMql?.removeEventListener("change", onDprChange);
            unsubscribeTheme();
            unsubscribeBus();
            worker.removeEventListener("message", onWorkerMessage);
            worker.terminate();
        },
    };
}
