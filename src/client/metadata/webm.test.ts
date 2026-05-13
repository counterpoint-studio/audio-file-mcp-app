import { describe, it, expect } from "vitest";
import { parseWebm } from "./webm";
import { loadFixture } from "./__fixtures__/load";

describe("parseWebm", () => {
    it("parses WebM/Opus", () => {
        const m = parseWebm(loadFixture("webm-opus-stereo-48000.webm"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 48000,
            codec: "Opus",
            sampleFormat: "compressed",
        });
        expect(m?.duration).toBeCloseTo(0.508, 2);
        expect(m?.durationExact).toBe(true);
    });

    it("parses WebM/Vorbis", () => {
        const m = parseWebm(loadFixture("webm-vorbis-stereo-44100.webm"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 44100,
            codec: "Vorbis",
        });
        expect(m?.duration).toBeCloseTo(0.524, 2);
        expect(m?.durationExact).toBe(true);
    });

    it("returns null for non-WebM bytes", () => {
        expect(parseWebm(new Uint8Array(64))).toBeNull();
    });
});
