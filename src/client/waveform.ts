import WaveformWorker from "./waveform-worker.ts?worker&inline";
import { type AudioDecodeFormat } from "./audio-formats";

export type Waveform = { destroy(): void };

export function createWaveform(
    blob: Blob,
    decodeFormat: AudioDecodeFormat | null,
    audio: HTMLAudioElement,
    seekBarEl: HTMLElement,
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
        },
        [offscreen],
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

    const postDuration = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            worker.postMessage({ type: "duration", seconds: audio.duration });
        }
    };
    if (audio.readyState >= 1) {
        // loadedmetadata already fired before we attached.
        postDuration();
    }
    audio.addEventListener("loadedmetadata", postDuration);

    const onWorkerMessage = (e: MessageEvent) => {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "error") {
            console.warn("[waveform] decode error:", data.message);
        }
    };
    worker.addEventListener("message", onWorkerMessage);

    return {
        destroy() {
            ro.disconnect();
            if (pendingResizeRaf !== 0) {
                cancelAnimationFrame(pendingResizeRaf);
                pendingResizeRaf = 0;
            }
            dprMql?.removeEventListener("change", onDprChange);
            audio.removeEventListener("loadedmetadata", postDuration);
            worker.removeEventListener("message", onWorkerMessage);
            worker.terminate();
        },
    };
}
