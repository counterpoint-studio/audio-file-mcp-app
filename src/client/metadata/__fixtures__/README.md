# Audio metadata test fixtures

This directory contains tiny audio files (mostly 0.1–0.5 s of a 440 Hz sine)
that the metadata parser tests load directly.

The files are checked in. They are **not** regenerated as part of `pnpm test`
or `pnpm build`. To refresh the corpus or add a new fixture, run:

```
./scripts/generate-test-fixtures.sh
```

## Prerequisites

The shell script needs `ffmpeg` on `PATH`. The Homebrew default formula covers
all codecs used here except AMR (encoders not bundled). AMR/QOA/MIDI fixtures
are synthesized by `scripts/build-synthetic-fixtures.mjs` (Node), which the
shell script invokes. Those three formats only need their header bytes valid
to exercise the parser — the synthesized files are not playable.
