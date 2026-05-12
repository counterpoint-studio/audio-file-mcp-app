import { describe, it, expect } from "vitest";
import { parseOgg } from "./ogg";
import { loadFixture } from "./__fixtures__/load";

describe("parseOgg", () => {
    it("parses Vorbis ID page", () => {
        const m = parseOgg(loadFixture("ogg-vorbis-stereo-44100.ogg"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 44100,
            codec: "Vorbis",
            sampleFormat: "compressed",
        });
        // Some encoders write 0 for bitrate_nominal in VBR mode — accept either
        // an undefined bitrate or a positive integer.
        if (m?.bitrate !== undefined) {
            expect(m.bitrate).toBeGreaterThan(0);
            expect(m.bitrateExact).toBe(true);
        }
    });

    it("parses Opus ID page (44.1k source — ffmpeg's libopus writes InputSampleRate=48000 regardless)", () => {
        const m = parseOgg(loadFixture("ogg-opus-input44100.opus"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 48000,
            codec: "Opus",
            sampleFormat: "compressed",
        });
        // Opus doesn't store target bitrate.
        expect(m?.bitrate).toBeUndefined();
        expect(m?.inputSampleRate).toBe(48000);
    });

    it("parses Opus with InputSampleRate=48000", () => {
        const m = parseOgg(loadFixture("ogg-opus-input48000.opus"));
        expect(m?.inputSampleRate).toBe(48000);
        expect(m?.sampleRate).toBe(48000);
    });

    it("reads non-48000 InputSampleRate from a synthetic OpusHead", () => {
        // Verify the parser surfaces inputSampleRate when an encoder *does*
        // store the original rate. ffmpeg's libopus doesn't, so we hand-build.
        const buf = new Uint8Array(27 + 1 + 8 + 11);
        // Ogg page header.
        buf.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
        buf[4] = 0; // version
        buf[5] = 0x02; // bos
        // bytes 6..25 zeroed (granule, serial, page seq, CRC)
        buf[26] = 0x01; // page_segments
        buf[27] = 19; // segment length = 8 ("OpusHead") + 11 fixed-size head fields
        // Payload: "OpusHead" + version + channels + preSkip + inputSR + gain + family
        const p = 28;
        buf.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], p);
        buf[p + 8] = 1; // version
        buf[p + 9] = 2; // channels
        buf[p + 10] = 0;
        buf[p + 11] = 0; // preSkip
        // inputSampleRate (LE) = 44100
        buf[p + 12] = 0x44;
        buf[p + 13] = 0xac;
        buf[p + 14] = 0x00;
        buf[p + 15] = 0x00;
        // outputGain (i16) + channel mapping family
        buf[p + 16] = 0;
        buf[p + 17] = 0;
        buf[p + 18] = 0;
        const m = parseOgg(buf);
        expect(m?.inputSampleRate).toBe(44100);
        expect(m?.sampleRate).toBe(48000);
    });

    it("returns null for non-Ogg bytes", () => {
        expect(parseOgg(new Uint8Array(64))).toBeNull();
    });
});
