#!/usr/bin/env bash
# Regenerate audio metadata test fixtures. Run manually after adding a fixture
# or refreshing the corpus. Not run by `pnpm test`. Requires ffmpeg with
# libmp3lame, libvorbis, libopus compiled in. AMR encoders are usually not
# available in stock ffmpeg builds, so AMR fixtures are synthesized by the
# Node helper script below (the AMR file format is trivial).

set -euo pipefail
OUT="$(cd "$(dirname "$0")/.."; pwd)/src/client/metadata/__fixtures__"
mkdir -p "$OUT"
rm -f "$OUT"/*.{wav,aiff,aif,flac,caf,amr,mp3,ogg,opus,aac,m4a,webm,wma,qoa,mid} 2>/dev/null || true

S() { ffmpeg -hide_banner -loglevel error -y -f lavfi \
    -i "sine=frequency=440:duration=$1:sample_rate=$2" "${@:3}"; }

# WAV variants
S 0.1 44100 -ac 2 -c:a pcm_s16le      "$OUT/wav-pcm16-stereo-44100.wav"
S 0.1 48000 -ac 1 -c:a pcm_s24le      "$OUT/wav-pcm24-mono-48000.wav"
S 0.1 48000 -ac 2 -c:a pcm_f32le      "$OUT/wav-pcmfloat32-stereo-48000.wav"
S 0.1 48000 -ac 6 -c:a pcm_s32le      "$OUT/wav-extensible-pcm32-6ch.wav"
S 0.1 8000  -ac 1 -c:a pcm_alaw       "$OUT/wav-alaw-mono-8000.wav"
S 0.1 8000  -ac 1 -c:a pcm_mulaw      "$OUT/wav-mulaw-mono-8000.wav"
S 0.1 22050 -ac 1 -c:a adpcm_ms       "$OUT/wav-adpcm-mono-22050.wav"

# AIFF/AIFC
S 0.1 44100 -ac 2 -c:a pcm_s16be -f aiff  "$OUT/aiff-pcm16-stereo-44100.aiff"
S 0.1 44100 -ac 2 -c:a pcm_s16le -f aiff  "$OUT/aifc-sowt-stereo-44100.aif"
S 0.1 48000 -ac 2 -c:a pcm_f32be -f aiff  "$OUT/aifc-fl32-stereo-48000.aif"
S 0.1 8000  -ac 1 -c:a pcm_mulaw -f aiff  "$OUT/aifc-ulaw-mono-8000.aif"

# FLAC
S 0.1 44100 -ac 2 -c:a flac -sample_fmt s16 "$OUT/flac-16bit-stereo-44100.flac"
S 0.1 96000 -ac 2 -c:a flac -sample_fmt s32 -bits_per_raw_sample 24 \
                                            "$OUT/flac-24bit-stereo-96000.flac"

# CAF
S 0.1 44100 -ac 2 -c:a pcm_s24be -f caf  "$OUT/caf-pcm24be-stereo-44100.caf"
S 0.1 48000 -ac 2 -c:a pcm_f32le -f caf  "$OUT/caf-pcmfloat-stereo-48000.caf"
S 0.3 44100 -ac 2 -c:a alac      -f caf  "$OUT/caf-alac-stereo-44100.caf"
# Note: ffmpeg's CAF muxer does not support AAC ("muxing codec currently unsupported");
# the AAC-in-CAF code path is exercised via a synthetic in-test buffer in caf.test.ts.

# MP3 (CBR, mono, VBR-with-Xing, ID3v2 prefix)
S 0.5 44100 -ac 2 -c:a libmp3lame -b:a 128k -id3v2_version 0 \
                                          "$OUT/mp3-cbr128-stereo-44100.mp3"
S 0.5 44100 -ac 1 -c:a libmp3lame -b:a 64k  -id3v2_version 0 \
                                          "$OUT/mp3-cbr64-mono-44100.mp3"
S 0.5 44100 -ac 2 -c:a libmp3lame -q:a 4 \
                                          "$OUT/mp3-vbr-xing-stereo-44100.mp3"
S 0.5 44100 -ac 2 -c:a libmp3lame -b:a 128k -metadata title=test \
                                          "$OUT/mp3-cbr128-with-id3v2.mp3"

# Ogg Vorbis / Opus
S 0.5 44100 -ac 2 -strict experimental -c:a vorbis -b:a 192k "$OUT/ogg-vorbis-stereo-44100.ogg"
S 0.5 44100 -ac 2 -c:a libopus             "$OUT/ogg-opus-input44100.opus"
S 0.5 48000 -ac 2 -c:a libopus             "$OUT/ogg-opus-input48000.opus"

# AAC / M4A
S 0.5 48000 -ac 2 -c:a aac -f adts                    "$OUT/aac-adts-lc-stereo-48000.aac"
S 0.5 48000 -ac 2 -c:a aac -b:a 128k                  "$OUT/m4a-aac-lc-stereo-48000.m4a"
S 0.5 48000 -ac 2 -c:a aac -b:a 128k -movflags +faststart \
                                                      "$OUT/m4a-aac-lc-moov-start.m4a"

# WebM
S 0.5 48000 -ac 2 -c:a libopus   -f webm "$OUT/webm-opus-stereo-48000.webm"
S 0.5 44100 -ac 2 -strict experimental -c:a vorbis -f webm "$OUT/webm-vorbis-stereo-44100.webm"

# WMA
S 0.5 44100 -ac 2 -c:a wmav2 -b:a 128k "$OUT/wma-v2-stereo-44100.wma"

# Synthetic fixtures: AMR (no ffmpeg encoder available in typical builds),
# QOA, MIDI (ffmpeg can't produce these for our purposes).
node "$(dirname "$0")/build-synthetic-fixtures.mjs" "$OUT"

echo "fixtures regenerated in $OUT"
