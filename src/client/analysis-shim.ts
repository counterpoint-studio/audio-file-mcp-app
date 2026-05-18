import {
    createAnalysisDriver,
    type AnalysisDriver,
    type AnalysisInMsg,
    type AnalysisOutMsg,
} from "./analysis/driver";

type Listener = (e: MessageEvent) => void;

export type DriverFactory = (opts: {
    post: (msg: AnalysisOutMsg) => void;
    decodeYieldEveryMs?: number;
}) => AnalysisDriver;

export class InProcessAnalysisWorker {
    private listeners = new Set<Listener>();
    private driver: AnalysisDriver;
    private terminated = false;

    constructor(driverFactory: DriverFactory = createAnalysisDriver) {
        this.driver = driverFactory({
            post: (msg) => this.dispatch(msg),
            decodeYieldEveryMs: 16,
        });
    }

    postMessage(msg: AnalysisInMsg, _transfer?: Transferable[]): void {
        if (this.terminated) return;
        // Match Worker's async semantics: callers expect handlers to observe
        // their own posts asynchronously, not synchronously.
        queueMicrotask(() => {
            if (this.terminated) return;
            this.driver.handleMessage(msg);
        });
    }

    addEventListener(type: "message", listener: Listener): void {
        if (type !== "message") return;
        this.listeners.add(listener);
    }

    removeEventListener(type: "message", listener: Listener): void {
        if (type !== "message") return;
        this.listeners.delete(listener);
    }

    terminate(): void {
        this.terminated = true;
        this.driver.terminate();
        this.listeners.clear();
    }

    private dispatch(msg: AnalysisOutMsg): void {
        if (this.terminated) return;
        const event = new MessageEvent("message", { data: msg });
        for (const l of this.listeners) l(event);
    }
}
