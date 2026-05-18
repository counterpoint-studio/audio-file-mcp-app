import WaveformWorker from "./analysis-worker.ts?worker&inline";
import { InProcessAnalysisWorker } from "./analysis-shim";
import { canUseBlobWorker } from "./analysis-worker-probe";

// Kick off the probe at module load so it's typically settled by the time
// the user opens a file.
void canUseBlobWorker();

// Structural subset of `Worker` used by callers (waveform.ts, player.ts,
// metrics.ts, spectrogram.ts, metadata-display.ts). Both the real Worker and
// InProcessAnalysisWorker satisfy this.
export type AnalysisWorker = {
    postMessage(msg: unknown, transfer?: Transferable[]): void;
    addEventListener(
        type: "message",
        listener: (e: MessageEvent) => void,
    ): void;
    removeEventListener(
        type: "message",
        listener: (e: MessageEvent) => void,
    ): void;
    terminate(): void;
};

export async function createAnalysisWorker(): Promise<AnalysisWorker> {
    return (await canUseBlobWorker())
        ? new WaveformWorker()
        : new InProcessAnalysisWorker();
}
