import { describe, it, expect } from "vitest";
import { parseCaf } from "./caf";
import { loadFixture } from "./__fixtures__/load";

describe("parseCaf", () => {
    it("parses CAF/lpcm 24-bit big-endian", () => {
        const m = parseCaf(loadFixture("caf-pcm24be-stereo-44100.caf"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 44100,
            bitDepth: 24,
            sampleFormat: "pcm-int",
        });
    });

    it("parses CAF/lpcm float 32-bit little-endian", () => {
        const m = parseCaf(loadFixture("caf-pcmfloat-stereo-48000.caf"));
        expect(m?.sampleFormat).toBe("pcm-float");
        expect(m?.bitDepth).toBe(32);
        expect(m?.sampleRate).toBe(48000);
    });

    it("parses CAF wrapping Apple Lossless", () => {
        const m = parseCaf(loadFixture("caf-alac-stereo-44100.caf"));
        expect(m?.codec).toBe("Apple Lossless");
        expect(m?.sampleFormat).toBe("compressed");
        expect(m?.channels).toBe(2);
    });

    it("parses synthetic CAF/aac desc chunk (AAC codepath, since ffmpeg can't mux CAF/AAC)", () => {
        // Build the smallest CAF that has a valid 'desc' chunk with 'aac '.
        const buf = new Uint8Array(8 + 12 + 32);
        const dv = new DataView(buf.buffer);
        // File header: "caff" + u16 version + u16 flags
        buf.set([0x63, 0x61, 0x66, 0x66], 0);
        dv.setUint16(4, 1, false); // version
        dv.setUint16(6, 0, false); // flags
        // Chunk header: "desc" + u64 size
        buf.set([0x64, 0x65, 0x73, 0x63], 8);
        dv.setUint32(12, 0, false);
        dv.setUint32(16, 32, false);
        // desc payload
        const p = 20;
        dv.setFloat64(p, 44100, false);
        buf.set([0x61, 0x61, 0x63, 0x20], p + 8); // "aac "
        dv.setUint32(p + 12, 0, false); // format flags
        dv.setUint32(p + 16, 0, false); // bytes/packet
        dv.setUint32(p + 20, 1024, false); // frames/packet
        dv.setUint32(p + 24, 2, false); // channels
        dv.setUint32(p + 28, 0, false); // bits/channel
        const m = parseCaf(buf);
        expect(m?.codec).toBe("AAC");
        expect(m?.sampleFormat).toBe("compressed");
        expect(m?.channels).toBe(2);
        expect(m?.sampleRate).toBe(44100);
    });

    it("returns null for bad magic", () => {
        expect(parseCaf(new Uint8Array(64))).toBeNull();
    });
});
