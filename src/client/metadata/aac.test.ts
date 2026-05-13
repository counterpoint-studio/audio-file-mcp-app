import { describe, it, expect } from "vitest";
import { parseAac } from "./aac";
import { loadFixture } from "./__fixtures__/load";

describe("parseAac", () => {
    it("parses ADTS AAC-LC stereo 48k", () => {
        const m = parseAac(loadFixture("aac-adts-lc-stereo-48000.aac"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 48000,
            codec: "AAC-LC",
            sampleFormat: "compressed",
        });
        expect(m?.bitrate).toBeUndefined();
        expect(m?.duration).toBeCloseTo(0.533, 2);
        expect(m?.durationExact).toBe(true);
    });

    it("returns null for non-ADTS bytes", () => {
        expect(parseAac(new Uint8Array(32))).toBeNull();
    });
});
