import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    canUseBlobWorker,
    __resetCanUseBlobWorkerCache,
} from "./analysis-worker-probe";

type FakeWorker = {
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: { message?: string }) => void) | null;
    terminate: ReturnType<typeof vi.fn>;
};

type WorkerCtor = (url: string) => FakeWorker;

function setGlobals(Worker: WorkerCtor | undefined): {
    restore: () => void;
    createObjectURL: ReturnType<typeof vi.fn>;
    revokeObjectURL: ReturnType<typeof vi.fn>;
} {
    const prevWorker = (globalThis as { Worker?: unknown }).Worker;
    const prevCreate = URL.createObjectURL;
    const prevRevoke = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    (globalThis as { Worker?: unknown }).Worker = Worker;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    return {
        restore: () => {
            (globalThis as { Worker?: unknown }).Worker = prevWorker;
            URL.createObjectURL = prevCreate;
            URL.revokeObjectURL = prevRevoke;
        },
        createObjectURL,
        revokeObjectURL,
    };
}

describe("canUseBlobWorker", () => {
    let cleanup: (() => void) | null = null;

    beforeEach(() => {
        __resetCanUseBlobWorkerCache();
    });

    afterEach(() => {
        cleanup?.();
        cleanup = null;
    });

    it("resolves true when the probe worker posts back, and caches the result", async () => {
        let created: FakeWorker | null = null;
        const WorkerCtor: WorkerCtor = vi.fn((_url: string) => {
            created = {
                onmessage: null,
                onerror: null,
                terminate: vi.fn(),
            };
            queueMicrotask(() => created?.onmessage?.({ data: "ok" }));
            return created;
        }) as unknown as WorkerCtor;
        const ctx = setGlobals(WorkerCtor);
        cleanup = ctx.restore;

        await expect(canUseBlobWorker()).resolves.toBe(true);
        expect(WorkerCtor).toHaveBeenCalledWith("blob:mock-url");
        expect(created?.terminate).toHaveBeenCalled();
        expect(ctx.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

        // Cached: same Promise / value, no second construction.
        await expect(canUseBlobWorker()).resolves.toBe(true);
        expect(WorkerCtor).toHaveBeenCalledTimes(1);
    });

    it("resolves false when the worker fires error before message", async () => {
        let created: FakeWorker | null = null;
        const WorkerCtor: WorkerCtor = vi.fn((_url: string) => {
            created = {
                onmessage: null,
                onerror: null,
                terminate: vi.fn(),
            };
            queueMicrotask(() => created?.onerror?.({ message: "blocked" }));
            return created;
        }) as unknown as WorkerCtor;
        const ctx = setGlobals(WorkerCtor);
        cleanup = ctx.restore;

        await expect(canUseBlobWorker()).resolves.toBe(false);
        expect(created?.terminate).toHaveBeenCalled();
        expect(ctx.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });

    it("resolves false when the worker is silent past the timeout", async () => {
        vi.useFakeTimers();
        try {
            const WorkerCtor: WorkerCtor = vi.fn(
                () =>
                    ({
                        onmessage: null,
                        onerror: null,
                        terminate: vi.fn(),
                    }) as FakeWorker,
            ) as unknown as WorkerCtor;
            const ctx = setGlobals(WorkerCtor);
            cleanup = () => {
                ctx.restore();
                vi.useRealTimers();
            };

            const probe = canUseBlobWorker();
            vi.advanceTimersByTime(500);
            await expect(probe).resolves.toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("resolves false when Worker construction itself throws", async () => {
        const WorkerCtor: WorkerCtor = vi.fn(() => {
            throw new Error("ctor threw");
        }) as unknown as WorkerCtor;
        const ctx = setGlobals(WorkerCtor);
        cleanup = ctx.restore;

        await expect(canUseBlobWorker()).resolves.toBe(false);
    });
});
