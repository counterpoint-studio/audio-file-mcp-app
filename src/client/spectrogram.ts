export type Spectrogram = { destroy(): void };

export function createSpectrogram(
    worker: Worker,
    wrapEl: HTMLElement,
): Spectrogram {
    // transferControlToOffscreen can only be called once per HTMLCanvasElement.
    // Replace the existing canvas so subsequent loads (each creates a fresh
    // worker) don't hit InvalidStateError on the second transfer.
    const oldCanvas = wrapEl.querySelector<HTMLCanvasElement>("#spectrogram");
    if (!oldCanvas) throw new Error("#spectrogram canvas missing");
    const canvas = document.createElement("canvas");
    canvas.id = "spectrogram";
    oldCanvas.replaceWith(canvas);

    const offscreen = canvas.transferControlToOffscreen();
    const initSize = canvas.getBoundingClientRect();
    worker.postMessage(
        {
            type: "spectrogram-canvas",
            canvas: offscreen,
            cssWidth: initSize.width,
            cssHeight: initSize.height,
            dpr: window.devicePixelRatio,
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
                type: "spectrogram-resize",
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
            type: "spectrogram-resize",
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
        destroy() {
            ro.disconnect();
            if (pendingResizeRaf !== 0) {
                cancelAnimationFrame(pendingResizeRaf);
                pendingResizeRaf = 0;
            }
            dprMql?.removeEventListener("change", onDprChange);
        },
    };
}
