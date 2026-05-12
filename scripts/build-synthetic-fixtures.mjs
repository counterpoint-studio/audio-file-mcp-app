#!/usr/bin/env node
// Synthesize tiny fixtures for formats where ffmpeg can't produce what we need:
//   - QOA (no encoder in ffmpeg)
//   - MIDI (ffmpeg has no MIDI muxer for our case)
//   - AMR (stock ffmpeg builds lack libopencore_amrnb / libvo_amrwbenc)
//
// Each file is *just* enough bytes that the corresponding parser can read its
// header. These are not playable audio; the test corpus exercises the parser,
// not the codec.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) {
    console.error("Usage: build-synthetic-fixtures.mjs <output-dir>");
    process.exit(1);
}

// --- QOA ---
// File header: "qoaf" + u32 total samples (BE) = 8 bytes.
// First frame header: u8 channels | u24 sampleRate | u16 fsamples | u16 framesize  (BE)
// Then per-channel: 16 bytes LMS history + 8 bytes one slice. For 2ch = 48 bytes.
function buildQoa() {
    const channels = 2;
    const sampleRate = 44100;
    const fsamples = 64;
    const frameSize = 8 + 16 * channels + 8 * channels; // header + LMS + 1 slice per ch
    const totalSamples = 64;
    const buf = Buffer.alloc(8 + frameSize);
    let o = 0;
    buf.write("qoaf", o, "ascii"); o += 4;
    buf.writeUInt32BE(totalSamples, o); o += 4;
    // Frame header
    buf.writeUInt8(channels, o); o += 1;
    buf.writeUIntBE(sampleRate, o, 3); o += 3;
    buf.writeUInt16BE(fsamples, o); o += 2;
    buf.writeUInt16BE(frameSize, o); o += 2;
    // LMS state + slices left zero.
    return buf;
}

// --- MIDI ---
// MThd | size=6 | format=1 | tracks=12 | division=480
// Followed by 12 empty MTrk chunks containing an end-of-track meta event.
function buildMidi() {
    const trackBody = Buffer.from([0x00, 0xff, 0x2f, 0x00]); // delta=0, meta end-of-track
    const trackChunk = Buffer.concat([
        Buffer.from("MTrk", "ascii"),
        (() => {
            const len = Buffer.alloc(4);
            len.writeUInt32BE(trackBody.length, 0);
            return len;
        })(),
        trackBody,
    ]);
    const header = Buffer.alloc(14);
    header.write("MThd", 0, "ascii");
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(1, 8); // format type
    header.writeUInt16BE(12, 10); // tracks
    header.writeUInt16BE(480, 12); // division (ticks per quarter)
    const tracks = Buffer.concat(Array(12).fill(trackChunk));
    return Buffer.concat([header, tracks]);
}

// --- AMR ---
// Magic "#!AMR\n" (or "#!AMR-WB\n") + one frame.
// Frame layout: 1 TOC byte + N bytes of speech data. We use mode 7 (12.2 kbps)
// for NB and mode 8 (23.85 kbps) for WB. Speech payload is zeroed; the parser
// only inspects the TOC byte.
function buildAmrNb() {
    const magic = Buffer.from("#!AMR\n", "ascii");
    // TOC byte: (mode << 3) | quality(1) bit. Mode 7 = 12.2 kbps.
    const toc = (7 << 3) | 0x04; // quality bit set (Q=1, good frame)
    // AMR-NB mode 7 frame payload is 31 bytes.
    const payload = Buffer.alloc(31);
    return Buffer.concat([magic, Buffer.from([toc]), payload]);
}

function buildAmrWb() {
    const magic = Buffer.from("#!AMR-WB\n", "ascii");
    const toc = (8 << 3) | 0x04; // mode 8 = 23.85 kbps
    // AMR-WB mode 8 payload is 60 bytes.
    const payload = Buffer.alloc(60);
    return Buffer.concat([magic, Buffer.from([toc]), payload]);
}

writeFileSync(join(outDir, "qoa-stereo-44100.qoa"), buildQoa());
writeFileSync(join(outDir, "midi-format1-12tracks.mid"), buildMidi());
writeFileSync(join(outDir, "amr-nb-mono-8000.amr"), buildAmrNb());
writeFileSync(join(outDir, "amr-wb-mono-16000.amr"), buildAmrWb());

console.log("synthetic fixtures written");
