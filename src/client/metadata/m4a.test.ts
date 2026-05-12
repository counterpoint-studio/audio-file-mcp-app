import { describe, it, expect } from "vitest";
import { parseM4a } from "./m4a";
import { loadFixture } from "./__fixtures__/load";

describe("parseM4a", () => {
    it("parses M4A with leading moov (+faststart)", () => {
        const m = parseM4a(loadFixture("m4a-aac-lc-moov-start.m4a"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 48000,
            codec: "AAC-LC",
            sampleFormat: "compressed",
        });
        expect(m?.bitrate).toBeGreaterThan(0);
        expect(m?.bitrateExact).toBe(true);
    });

    it("parses M4A with trailing moov (default ffmpeg layout)", () => {
        const m = parseM4a(loadFixture("m4a-aac-lc-stereo-48000.m4a"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 48000,
            codec: "AAC-LC",
        });
    });

    it("walks 64-bit atom size (size=1 + u64 extended)", () => {
        // Build a minimal MP4 with one extended-size 'free' atom, then ftyp.
        // ftyp comes first (required); we add a free atom before moov to
        // exercise size=1 handling without breaking the walker.
        const ftypSize = 16;
        const freeHeaderSize = 16; // size=1 marker + u64 size
        const freeBody = 8;
        const total = ftypSize + freeHeaderSize + freeBody;
        const buf = new Uint8Array(total);
        const dv = new DataView(buf.buffer);
        // ftyp
        dv.setUint32(0, ftypSize, false);
        buf.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
        buf.set([0x4d, 0x34, 0x41, 0x20], 8); // major brand "M4A "
        dv.setUint32(12, 0, false); // minor version
        // free atom with extended 64-bit size
        const fp = ftypSize;
        dv.setUint32(fp, 1, false); // size=1 → extended
        buf.set([0x66, 0x72, 0x65, 0x65], fp + 4); // "free"
        dv.setUint32(fp + 8, 0, false); // u64 size hi
        dv.setUint32(fp + 12, freeHeaderSize + freeBody, false); // u64 size lo
        // Walker should not throw and should return null (no moov).
        expect(() => parseM4a(buf)).not.toThrow();
        expect(parseM4a(buf)).toBeNull();
    });

    it("returns null for non-MP4 bytes", () => {
        expect(parseM4a(new Uint8Array(64))).toBeNull();
    });
});
