# Regenerating the DSP modules

The DSP module bundles PFFFT (FFT), libebur128 (loudness), the spectrogram
render kernel, and the reassignment helpers into Emscripten-built artifacts.
Two backends are produced from the same C sources:

- `src/client/dsp/wasm-dsp.gen.ts` — `-sWASM=1 -msimd128` build, the
  default and preferred path.
- `src/client/dsp/js-dsp.gen.ts` — `-sWASM=0 -sDYNAMIC_EXECUTION=0` (asm.js)
  build, used as a CSP-safe fallback when the host doesn't grant
  `script-src 'wasm-unsafe-eval'`.

Both files are **checked in** — normal contributors do not need Emscripten
to build or run the app. The two backends are symbol-compatible (same
`EXPORTED_FUNCTIONS`); a runtime loader (`src/client/dsp/dsp-loader.ts`)
picks WASM first and falls back to JS on instantiation failure.

Only re-run the build when the vendored C sources in `vendor/pffft/`,
`vendor/libebur128/`, or `src/wasm/` change.

## Prerequisites

[emsdk](https://emscripten.org/docs/getting_started/downloads.html) installed
and activated in the current shell:

```sh
source /path/to/emsdk/emsdk_env.sh
```

Verify with `emcc --version` (Emscripten 4.x or 5.x).

## Regenerate

Both backends at once:

```sh
pnpm build:dsp
```

Or individually:

```sh
pnpm build:wasm     # → src/client/dsp/wasm-dsp.gen.ts
pnpm build:js-dsp   # → src/client/dsp/js-dsp.gen.ts
```

`pnpm build:wasm` runs `scripts/build-wasm.sh`, which:

1. Compiles the C sources with `emcc -O3 -msimd128 -msse -msse2` into
   `build/wasm/wasm-dsp.{mjs,wasm}` (`ALLOW_MEMORY_GROWTH`, `MODULARIZE`).
2. Runs `scripts/inline-wasm.mjs` to base64-encode the `.wasm`, splice the
   Emscripten ES-module glue, and write `src/client/dsp/wasm-dsp.gen.ts`.

`pnpm build:js-dsp` runs `scripts/build-js-dsp.sh`, which:

1. Compiles the same C sources with `emcc -O3 -sWASM=0
   -sDYNAMIC_EXECUTION=0` (no SIMD flags) into `build/js-dsp/js-dsp.mjs`.
   `DYNAMIC_EXECUTION=0` prevents any `eval`/`new Function` paths in
   Emscripten's support code, required for the bundle to load under
   `script-src 'self'`.
2. Runs `scripts/inline-js-dsp.mjs` to splice the glue and write
   `src/client/dsp/js-dsp.gen.ts`.

Commit the regenerated files together with whatever vendor change prompted
the rebuild. `build/` is git-ignored.

`pnpm build` and `pnpm install` never invoke these — only contributors who
touch the C sources need them.

## CSP fallback smoke test

To verify the JS fallback engages under a real restrictive CSP:

1. `pnpm build` to produce `dist/index.html`.
2. Serve `dist/` with a static server that sets
   `Content-Security-Policy: script-src 'self'; worker-src 'self'`
   (no `wasm-unsafe-eval`, no `blob:`).
3. Open the page and load a file.
4. Confirm the console logs `WASM DSP unavailable, using JS fallback:
   ...` and that the spectrogram + footer LUFS still render.

With the permissive CSP (`'wasm-unsafe-eval'` added) the fallback message
must be absent — WASM stays the default path.
