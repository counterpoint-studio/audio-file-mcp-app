import { describe, it, expect } from "vitest";
import { parseQoa } from "./qoa";
import { loadFixture } from "./__fixtures__/load";

describe("parseQoa", () => {
    it("parses QOA file/frame header", () => {
        const m = parseQoa(loadFixture("qoa-stereo-44100.qoa"));
        expect(m).toMatchObject({
            channels: 2,
            channelLayout: "stereo",
            sampleRate: 44100,
            codec: "QOA",
            sampleFormat: "compressed",
        });
    });

    it("returns null for bad magic", () => {
        expect(parseQoa(new Uint8Array(32))).toBeNull();
    });
});
