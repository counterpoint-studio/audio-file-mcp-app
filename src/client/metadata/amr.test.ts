import { describe, it, expect } from "vitest";
import { parseAmr } from "./amr";
import { extractMetadata } from "./index";
import { loadFixture } from "./__fixtures__/load";

describe("parseAmr", () => {
    it("parses AMR-NB with mode 7 (12.2 kbps)", () => {
        const m = parseAmr(loadFixture("amr-nb-mono-8000.amr"));
        expect(m).toMatchObject({
            channels: 1,
            channelLayout: "mono",
            sampleRate: 8000,
            codec: "AMR-NB",
            bitrate: 12200,
            bitrateExact: true,
        });
    });

    it("parses AMR-WB with mode 8 (23.85 kbps)", () => {
        const m = parseAmr(loadFixture("amr-wb-mono-16000.amr"));
        expect(m).toMatchObject({
            channels: 1,
            sampleRate: 16000,
            codec: "AMR-WB",
            bitrate: 23850,
        });
    });

    it("returns null for non-AMR bytes", () => {
        expect(parseAmr(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
    });

    it("estimates duration via extractMetadata from mode-derived bitrate", () => {
        const bytes = loadFixture("amr-nb-mono-8000.amr");
        const m = extractMetadata("amr", bytes, bytes.length);
        expect(m?.duration).toBeGreaterThan(0);
        expect(m?.durationExact).toBe(false);
    });
});
