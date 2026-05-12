import { describe, it, expect } from "vitest";
import { parseMidi } from "./midi";
import { loadFixture } from "./__fixtures__/load";

describe("parseMidi", () => {
    it("parses MThd of format 1 with 12 tracks", () => {
        const m = parseMidi(loadFixture("midi-format1-12tracks.mid"));
        expect(m).toMatchObject({
            midiFormatType: 1,
            midiTrackCount: 12,
            midiDivision: 480,
        });
    });

    it("returns null for non-MIDI bytes", () => {
        expect(parseMidi(new Uint8Array(64))).toBeNull();
    });
});
