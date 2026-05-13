import { describe, it, expect } from "vitest";
import { parseWma } from "./wma";
import { loadFixture } from "./__fixtures__/load";

describe("parseWma", () => {
    it("parses WMA v2 stereo 44.1k @ 128 kbps", () => {
        const m = parseWma(loadFixture("wma-v2-stereo-44100.wma"));
        expect(m).toMatchObject({
            channels: 2,
            sampleRate: 44100,
            codec: "Windows Media Audio 2",
            sampleFormat: "compressed",
            bitrateExact: true,
        });
        expect(m?.bitrate).toBeGreaterThan(120_000);
        expect(m?.bitrate).toBeLessThan(140_000);
        expect(m?.duration).toBeCloseTo(0.5, 1);
        expect(m?.durationExact).toBe(true);
    });

    it("returns null for non-ASF bytes", () => {
        expect(parseWma(new Uint8Array(64))).toBeNull();
    });
});
