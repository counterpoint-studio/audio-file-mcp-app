import { describe, it, expect } from "vitest";
import { parseAiff } from "./aiff";
import { loadFixture } from "./__fixtures__/load";

describe("parseAiff", () => {
    it("parses plain AIFF (FORM/AIFF) big-endian 16-bit", () => {
        const m = parseAiff(loadFixture("aiff-pcm16-stereo-44100.aiff"));
        expect(m).toMatchObject({
            channels: 2,
            channelLayout: "stereo",
            sampleRate: 44100,
            bitDepth: 16,
            sampleFormat: "pcm-int",
            durationExact: true,
        });
        expect(m?.duration).toBeCloseTo(0.1, 3);
    });

    it("parses AIFC with 'sowt' (little-endian PCM)", () => {
        const m = parseAiff(loadFixture("aifc-sowt-stereo-44100.aif"));
        expect(m?.sampleFormat).toBe("pcm-int");
        expect(m?.codec).toMatch(/little-endian/i);
        expect(m?.bitDepth).toBe(16);
        expect(m?.sampleRate).toBe(44100);
    });

    it("parses AIFC with 'fl32' (32-bit float)", () => {
        const m = parseAiff(loadFixture("aifc-fl32-stereo-48000.aif"));
        expect(m?.sampleFormat).toBe("pcm-float");
        expect(m?.bitDepth).toBe(32);
        expect(m?.sampleRate).toBe(48000);
    });

    it("parses AIFC with 'ulaw'", () => {
        const m = parseAiff(loadFixture("aifc-ulaw-mono-8000.aif"));
        expect(m?.sampleFormat).toBe("mulaw");
        expect(m?.channels).toBe(1);
        expect(m?.sampleRate).toBe(8000);
    });

    it("returns null for truncated buffer", () => {
        expect(parseAiff(new Uint8Array(8))).toBeNull();
    });
});
