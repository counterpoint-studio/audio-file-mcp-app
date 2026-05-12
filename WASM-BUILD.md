# Regenerating `wasm-dsp.gen.ts`

The DSP module bundles PFFFT (FFT) and libebur128 (loudness) into a single
Emscripten-built WebAssembly artifact, base64-inlined into
`src/client/dsp/wasm-dsp.gen.ts`. That file is **checked in** — normal
contributors do not need Emscripten to build or run the app.

Only re-run the build when the vendored C sources in `vendor/pffft/` or
`vendor/libebur128/` change.

## Prerequisites

[emsdk](https://emscripten.org/docs/getting_started/downloads.html) installed
and activated in the current shell:

```sh
source /path/to/emsdk/emsdk_env.sh
```

Verify with `emcc --version` (Emscripten 4.x or 5.x).

## Regenerate

```sh
pnpm build:wasm
```

This runs `scripts/build-wasm.sh`, which:

1. Compiles `vendor/pffft/pffft.c` + `vendor/libebur128/ebur128.c` with `emcc`
   into `build/wasm/wasm-dsp.{mjs,wasm}` (`-O3 -msimd128 -msse -msse2`,
   `ALLOW_MEMORY_GROWTH`, `MODULARIZE`).
2. Runs `scripts/inline-wasm.mjs` to base64-encode the `.wasm`, splice the
   Emscripten ES-module glue, and write `src/client/dsp/wasm-dsp.gen.ts`.

Commit the regenerated `wasm-dsp.gen.ts` together with whatever vendor change
prompted the rebuild. `build/` is git-ignored.

`pnpm build` and `pnpm install` never invoke this — only contributors who
touch the C sources need it.
