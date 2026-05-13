import { describe, it, expect } from "vitest";
import { parseWav } from "./wav";
import { loadFixture } from "./__fixtures__/load";

describe("parseWav", () => {
    it("parses 16-bit stereo 44.1k PCM", () => {
        const m = parseWav(loadFixture("wav-pcm16-stereo-44100.wav"));
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

    it("computes duration from the data chunk size and avgBytesPerSec", () => {
        const m = parseWav(loadFixture("wav-pcm24-mono-48000.wav"));
        expect(m?.duration).toBeCloseTo(0.1, 3);
        expect(m?.durationExact).toBe(true);
    });

    it("parses 24-bit mono 48k PCM", () => {
        const m = parseWav(loadFixture("wav-pcm24-mono-48000.wav"));
        expect(m).toMatchObject({
            channels: 1,
            channelLayout: "mono",
            sampleRate: 48000,
            bitDepth: 24,
            sampleFormat: "pcm-int",
        });
    });

    it("parses 32-bit float WAV", () => {
        const m = parseWav(loadFixture("wav-pcmfloat32-stereo-48000.wav"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 48000,
            bitDepth: 32,
            sampleFormat: "pcm-float",
        });
    });

    it("parses WAVE_FORMAT_EXTENSIBLE 32-bit 6-channel (sub-format PCM)", () => {
        const m = parseWav(loadFixture("wav-extensible-pcm32-6ch.wav"));
        expect(m).toMatchObject({
            channels: 6,
            channelLayout: "6-channel",
            sampleRate: 48000,
            bitDepth: 32,
            sampleFormat: "pcm-int",
        });
    });

    it("parses A-law", () => {
        const m = parseWav(loadFixture("wav-alaw-mono-8000.wav"));
        expect(m?.sampleFormat).toBe("alaw");
        expect(m?.channels).toBe(1);
        expect(m?.sampleRate).toBe(8000);
    });

    it("parses μ-law", () => {
        const m = parseWav(loadFixture("wav-mulaw-mono-8000.wav"));
        expect(m?.sampleFormat).toBe("mulaw");
    });

    it("parses ADPCM", () => {
        const m = parseWav(loadFixture("wav-adpcm-mono-22050.wav"));
        expect(m?.sampleFormat).toBe("adpcm");
        expect(m?.channels).toBe(1);
        expect(m?.sampleRate).toBe(22050);
    });

    it("returns null for a truncated buffer", () => {
        expect(parseWav(new Uint8Array(8))).toBeNull();
    });

    it("returns null for garbage magic", () => {
        const bytes = new Uint8Array(64);
        bytes.set([0x58, 0x58, 0x58, 0x58], 0); // "XXXX"
        expect(parseWav(bytes)).toBeNull();
    });
});
