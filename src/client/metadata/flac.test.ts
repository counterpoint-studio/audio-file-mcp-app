import { describe, it, expect } from "vitest";
import { parseFlac } from "./flac";
import { loadFixture } from "./__fixtures__/load";

describe("parseFlac", () => {
    it("parses 16-bit stereo 44.1k FLAC", () => {
        const m = parseFlac(loadFixture("flac-16bit-stereo-44100.flac"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 44100,
            bitDepth: 16,
            sampleFormat: "pcm-int",
            durationExact: true,
        });
        expect(m?.duration).toBeCloseTo(0.1, 3);
    });

    it("parses 24-bit 96k FLAC (bit-packed STREAMINFO fields)", () => {
        const m = parseFlac(loadFixture("flac-24bit-stereo-96000.flac"));
        expect(m?.bitDepth).toBe(24);
        expect(m?.sampleRate).toBe(96000);
        expect(m?.channels).toBe(2);
        expect(m?.duration).toBeCloseTo(0.1, 3);
        expect(m?.durationExact).toBe(true);
    });

    it("returns null for bad magic", () => {
        const bytes = new Uint8Array(64);
        bytes.set([0x58, 0x58, 0x58, 0x58], 0); // "XXXX"
        expect(parseFlac(bytes)).toBeNull();
    });
});
