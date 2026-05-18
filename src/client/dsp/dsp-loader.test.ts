import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    instantiate,
    getInstance,
    getBackend,
    __resetForTests,
    __setFactoriesForTests,
} from "./dsp-loader";

beforeEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("dsp-loader", () => {
    it("uses the WASM factory on success and never calls the JS factory", async () => {
        const wasmModule = { tag: "wasm" };
        const wasmFactory = vi.fn(async () => wasmModule);
        const jsFactory = vi.fn(async () => ({ tag: "js" }));
        __setFactoriesForTests(wasmFactory, jsFactory);

        const inst = await instantiate();

        expect(inst).toBe(wasmModule);
        expect(getInstance()).toBe(wasmModule);
        expect(getBackend()).toBe("wasm");
        expect(wasmFactory).toHaveBeenCalledTimes(1);
        expect(jsFactory).not.toHaveBeenCalled();
    });

    it("falls back to the JS factory when the WASM factory rejects", async () => {
        const jsModule = { tag: "js" };
        const wasmFactory = vi.fn(async () => {
            throw new Error("CSP blocked WebAssembly.compile");
        });
        const jsFactory = vi.fn(async () => jsModule);
        __setFactoriesForTests(wasmFactory, jsFactory);

        const inst = await instantiate();

        expect(inst).toBe(jsModule);
        expect(getInstance()).toBe(jsModule);
        expect(getBackend()).toBe("js");
        expect(wasmFactory).toHaveBeenCalledTimes(1);
        expect(jsFactory).toHaveBeenCalledTimes(1);
    });

    it("dedupes concurrent instantiate() calls", async () => {
        const wasmModule = { tag: "wasm" };
        const wasmFactory = vi.fn(async () => {
            await new Promise((r) => setTimeout(r, 5));
            return wasmModule;
        });
        const jsFactory = vi.fn(async () => ({ tag: "js" }));
        __setFactoriesForTests(wasmFactory, jsFactory);

        const [a, b, c] = await Promise.all([
            instantiate(),
            instantiate(),
            instantiate(),
        ]);

        expect(a).toBe(wasmModule);
        expect(b).toBe(wasmModule);
        expect(c).toBe(wasmModule);
        expect(wasmFactory).toHaveBeenCalledTimes(1);
    });

    it("returns the cached instance on subsequent calls", async () => {
        const wasmFactory = vi.fn(async () => ({ tag: "wasm" }));
        const jsFactory = vi.fn(async () => ({ tag: "js" }));
        __setFactoriesForTests(wasmFactory, jsFactory);

        const a = await instantiate();
        const b = await instantiate();

        expect(a).toBe(b);
        expect(wasmFactory).toHaveBeenCalledTimes(1);
    });

    it("getInstance throws before instantiate() has resolved", () => {
        expect(() => getInstance()).toThrow(/not instantiated/);
    });

    it("__resetForTests clears state so a new backend choice can be made", async () => {
        const wasm1 = { tag: "wasm-1" };
        const wasmFactory1 = vi.fn(async () => wasm1);
        __setFactoriesForTests(wasmFactory1, vi.fn(async () => ({})));
        await instantiate();
        expect(getBackend()).toBe("wasm");

        __resetForTests();
        expect(getBackend()).toBeNull();

        const jsModule = { tag: "js-after-reset" };
        const wasmFactory2 = vi.fn(async () => {
            throw new Error("blocked");
        });
        const jsFactory2 = vi.fn(async () => jsModule);
        __setFactoriesForTests(wasmFactory2, jsFactory2);

        const inst = await instantiate();
        expect(inst).toBe(jsModule);
        expect(getBackend()).toBe("js");
    });
});
