import { createWasmDsp, getWasmBinary } from "./wasm-dsp.gen";
import { createJsDsp } from "./js-dsp.gen";

export type DspBackend = "wasm" | "js";

type DspFactory = (opts: Record<string, unknown>) => Promise<unknown>;

let _instance: unknown = null;
let _backend: DspBackend | null = null;
let _pending: Promise<unknown> | null = null;
let _wasmFactory: DspFactory = createWasmDsp as DspFactory;
let _jsFactory: DspFactory = createJsDsp as DspFactory;

export async function instantiate(): Promise<unknown> {
    if (_instance) return _instance;
    if (_pending) return _pending;
    _pending = (async () => {
        try {
            _instance = await _wasmFactory({
                wasmBinary: getWasmBinary(),
                locateFile: (path: string) => path,
            });
            _backend = "wasm";
        } catch (err) {
            // Under blocking CSP, WebAssembly.compile rejects and surfaces
            // here as the awaited factory's rejection. The catch is broad
            // on purpose: anything that prevents the WASM factory from
            // returning a Module engages the JS fallback.
            console.warn(
                "WASM DSP unavailable, using JS fallback:",
                err instanceof Error ? err.message : err,
            );
            _instance = await _jsFactory({});
            _backend = "js";
        }
        return _instance;
    })();
    return _pending;
}

export function getInstance(): unknown {
    if (!_instance) {
        throw new Error("dsp not instantiated — await instantiate() first");
    }
    return _instance;
}

export function getBackend(): DspBackend | null {
    return _backend;
}

export function __resetForTests(): void {
    _instance = null;
    _backend = null;
    _pending = null;
    _wasmFactory = createWasmDsp as DspFactory;
    _jsFactory = createJsDsp as DspFactory;
}

export function __setFactoriesForTests(
    wasmFactory: DspFactory,
    jsFactory: DspFactory,
): void {
    _wasmFactory = wasmFactory;
    _jsFactory = jsFactory;
}
