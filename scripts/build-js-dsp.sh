#!/usr/bin/env bash
set -euo pipefail

# Build PFFFT + libebur128 + render + reassign into a -sWASM=0 (asm.js)
# Emscripten artifact and post-process it into
# src/client/dsp/js-dsp.gen.ts. This is the CSP-safe fallback used when the
# host doesn't grant 'wasm-unsafe-eval'.
#
# Requires emsdk to be activated: `source /path/to/emsdk_env.sh`
# Not run by `pnpm build` or `pnpm install` — invoke as `pnpm build:js-dsp` on
# a developer machine when the C sources change.

cd "$(dirname "$0")/.."

OUTDIR=build/js-dsp
mkdir -p "$OUTDIR"

# Must match scripts/build-wasm.sh — the two backends are symbol-compatible.
EXPORTS='[
  "_malloc","_free",
  "_pffft_new_setup","_pffft_destroy_setup",
  "_pffft_transform_ordered","_pffft_aligned_malloc","_pffft_aligned_free",
  "_ebur128_init","_ebur128_destroy",
  "_ebur128_add_frames_float",
  "_ebur128_loudness_global","_ebur128_loudness_momentary",
  "_ebur128_loudness_shortterm","_ebur128_loudness_range",
  "_ebur128_true_peak","_ebur128_sample_peak",
  "_render_grid_to_rgba",
  "_reassign_init","_reassign_set_frames_per_col","_reassign_reset",
  "_reassign_process_frame","_reassign_render",
  "_reassign_get_current_col","_reassign_get_frames_in_col",
  "_reassign_get_max_col_touched","_reassign_get_grid_ptr"
]'

emcc \
  vendor/pffft/pffft.c \
  vendor/libebur128/ebur128.c \
  src/wasm/render.c \
  src/wasm/reassign.c \
  -O3 \
  -I vendor/pffft \
  -I vendor/libebur128 \
  -I vendor/libebur128/queue \
  -I src/wasm \
  -s WASM=0 \
  -s DYNAMIC_EXECUTION=0 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createJsDsp \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=16MB \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32","HEAPF64","HEAPU32","HEAPU8"]' \
  -o "$OUTDIR/js-dsp.mjs"

node scripts/inline-js-dsp.mjs \
  "$OUTDIR/js-dsp.mjs" \
  src/client/dsp/js-dsp.gen.ts

echo "→ src/client/dsp/js-dsp.gen.ts regenerated"
