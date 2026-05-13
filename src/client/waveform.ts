import WaveformWorker from "./analysis-worker.ts?worker&inline";
import { type AudioDecodeFormat } from "./audio-formats";
import { getTheme, subscribeTheme } from "./theme";

export type Waveform = { destroy(): void; worker: Worker };

export function createWaveform(
    blob: Blob,
    decodeFormat: AudioDecodeFormat | null,
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
            blob,
            format: decodeFormat,
            durationSeconds,
            durationExact,
            theme: getTheme(),
        },
        [offscreen],
    );

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
            worker.terminate();
        },
    };
}
