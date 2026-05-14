#!/usr/bin/env bash
set -euo pipefail

# Build PFFFT + libebur128 into a single Emscripten artifact and post-process it
# into src/client/dsp/wasm-dsp.gen.ts with the .wasm base64-inlined and the
# JS factory wrapped behind a typed instantiate() function.
#
# Requires emsdk to be activated: `source /path/to/emsdk_env.sh`
# Not run by `pnpm build` or `pnpm install` — invoke as `pnpm build:wasm` on
# a developer machine when the C sources change.

cd "$(dirname "$0")/.."

OUTDIR=build/wasm
mkdir -p "$OUTDIR"

EXPORTS='[
  "_malloc","_free",
  "_pffft_new_setup","_pffft_destroy_setup",
  "_pffft_transform_ordered","_pffft_aligned_malloc","_pffft_aligned_free",
  "_ebur128_init","_ebur128_destroy",
  "_ebur128_add_frames_float",
  "_ebur128_loudness_global","_ebur128_loudness_momentary",
  "_ebur128_loudness_shortterm","_ebur128_loudness_range",
  "_ebur128_true_peak","_ebur128_sample_peak",
  "_render_grid_to_rgba"
]'

emcc \
  vendor/pffft/pffft.c \
  vendor/libebur128/ebur128.c \
  src/wasm/render.c \
  -O3 -msimd128 -msse -msse2 \
  -I vendor/pffft \
  -I vendor/libebur128 \
  -I vendor/libebur128/queue \
  -I src/wasm \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createWasmDsp \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=16MB \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -s INCOMING_MODULE_JS_API='["wasmBinary"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32","HEAPF64","HEAPU32","HEAPU8"]' \
  -o "$OUTDIR/wasm-dsp.mjs"

node scripts/inline-wasm.mjs \
  "$OUTDIR/wasm-dsp.wasm" \
  "$OUTDIR/wasm-dsp.mjs" \
  src/client/dsp/wasm-dsp.gen.ts

echo "→ src/client/dsp/wasm-dsp.gen.ts regenerated"
