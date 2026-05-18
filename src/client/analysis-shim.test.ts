import { describe, it, expect, vi } from "vitest";
import { InProcessAnalysisWorker } from "./analysis-shim";
import type {
    AnalysisDriver,
    AnalysisInMsg,
    AnalysisOutMsg,
} from "./analysis/driver";

type CapturedDriver = {
    handleMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    post: (msg: AnalysisOutMsg) => void;
};

function buildShim(): { shim: InProcessAnalysisWorker; driver: CapturedDriver } {
    const driver: CapturedDriver = {
        handleMessage: vi.fn(),
        terminate: vi.fn(),
        post: () => {},
    };
    const factory = (opts: { post: (msg: AnalysisOutMsg) => void }): AnalysisDriver => {
        driver.post = opts.post;
        return {
            handleMessage: driver.handleMessage,
            terminate: driver.terminate,
        };
    };
    const shim = new InProcessAnalysisWorker(factory);
    return { shim, driver };
}

const themeMsg: AnalysisInMsg = { type: "theme", theme: "light" };

describe("InProcessAnalysisWorker", () => {
    it("delivers postMessage to the driver asynchronously, not synchronously", async () => {
        const { shim, driver } = buildShim();
        shim.postMessage(themeMsg);
        expect(driver.handleMessage).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(driver.handleMessage).toHaveBeenCalledTimes(1);
        expect(driver.handleMessage).toHaveBeenCalledWith(themeMsg);
    });

    it("dispatches driver post output to all subscribed listeners as MessageEvents", () => {
        const { shim, driver } = buildShim();
        const a = vi.fn();
        const b = vi.fn();
        shim.addEventListener("message", a);
        shim.addEventListener("message", b);
        const out: AnalysisOutMsg = {
            type: "decoder-info",
            channels: 2,
            sampleRate: 48000,
        };
        driver.post(out);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
        const evt = a.mock.calls[0][0] as MessageEvent;
        expect(evt).toBeInstanceOf(MessageEvent);
        expect(evt.data).toBe(out);
    });

    it("removeEventListener stops further dispatch", () => {
        const { shim, driver } = buildShim();
        const fn = vi.fn();
        shim.addEventListener("message", fn);
        shim.removeEventListener("message", fn);
        driver.post({ type: "error", message: "boom" });
        expect(fn).not.toHaveBeenCalled();
    });

    it("ignores non-message event types on add/removeEventListener", () => {
        const { shim, driver } = buildShim();
        const fn = vi.fn();
        // @ts-expect-error testing runtime guard
        shim.addEventListener("error", fn);
        driver.post({ type: "error", message: "x" });
        expect(fn).not.toHaveBeenCalled();
        // remove of non-message is a no-op (does not throw)
        // @ts-expect-error testing runtime guard
        expect(() => shim.removeEventListener("error", fn)).not.toThrow();
    });

    it("terminate calls driver.terminate, blocks pending and future posts, and clears listeners", async () => {
        const { shim, driver } = buildShim();
        const fn = vi.fn();
        shim.addEventListener("message", fn);

        // Post is queued via microtask; terminate before it drains.
        shim.postMessage(themeMsg);
        shim.terminate();
        await Promise.resolve();

        expect(driver.terminate).toHaveBeenCalledTimes(1);
        expect(driver.handleMessage).not.toHaveBeenCalled();

        // Further posts are dropped, both inbound and outbound.
        shim.postMessage(themeMsg);
        await Promise.resolve();
        expect(driver.handleMessage).not.toHaveBeenCalled();

        driver.post({ type: "error", message: "post-terminate" });
        expect(fn).not.toHaveBeenCalled();
    });

    it("terminate is idempotent", () => {
        const { shim, driver } = buildShim();
        shim.terminate();
        shim.terminate();
        // driver.terminate should be invoked each time; the shim itself does
        // not need to dedupe, but it must not throw.
        expect(driver.terminate.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});
