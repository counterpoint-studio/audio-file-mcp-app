import { describe, it, expect } from "vitest";
import { basename, formatSpec } from "./metadata-spec";
import type { AudioMetadata } from "./metadata";

function meta(overrides: Partial<AudioMetadata>): AudioMetadata {
    return {
        container: "wav",
        sizeBytes: 0,
        ...overrides,
    };
}

describe("basename", () => {
    it("returns the last path segment", () => {
        expect(basename("/Users/me/file.wav")).toBe("file.wav");
    });
    it("returns the whole string when there is no slash", () => {
        expect(basename("file.wav")).toBe("file.wav");
    });
    it("handles trailing slash as empty basename", () => {
        expect(basename("/a/b/")).toBe("");
    });
});

describe("formatSpec", () => {
    it("returns empty for null metadata", () => {
        expect(formatSpec(null, undefined, undefined)).toBe("");
    });

    it("PCM 16-bit @ 48 kHz", () => {
        const m = meta({
            sampleRate: 48000,
            bitDepth: 16,
            sampleFormat: "pcm-int",
        });
        expect(formatSpec(m, undefined, undefined)).toBe("48kHz / 16bit");
    });

    it("32-bit float WAV @ 48 kHz", () => {
        const m = meta({
            sampleRate: 48000,
            bitDepth: 32,
            sampleFormat: "pcm-float",
        });
        expect(formatSpec(m, undefined, undefined)).toBe("48kHz / 32bit float");
    });

    it("A-law @ 8 kHz", () => {
        const m = meta({ sampleRate: 8000, sampleFormat: "alaw" });
        expect(formatSpec(m, undefined, undefined)).toBe("8kHz / A-law");
    });

    it("CBR MP3 @ 44.1 kHz / 192 kbps", () => {
        const m = meta({
            container: "mp3",
            sampleRate: 44100,
            sampleFormat: "compressed",
            bitrate: 192000,
            bitrateExact: true,
            bitrateMode: "cbr",
        });
        expect(formatSpec(m, undefined, undefined)).toBe(
            "44.1kHz / 192kbps (CBR)",
        );
    });

    it("VBR MP3 @ 44.1 kHz approx", () => {
        const m = meta({
            container: "mp3",
            sampleRate: 44100,
            sampleFormat: "compressed",
            bitrate: 192000,
            bitrateExact: false,
            bitrateMode: "vbr",
        });
        expect(formatSpec(m, undefined, undefined)).toBe(
            "44.1kHz / ≈192kbps (VBR)",
        );
    });

    it("Opus @ 48 kHz with derived bitrate from duration", () => {
        const m = meta({
            container: "opus",
            sampleRate: 48000,
            sampleFormat: "compressed",
            sizeBytes: 96_000, // 768 kbit total
        });
        const out = formatSpec(m, undefined, 8); // 8 s → 96 kbps
        expect(out).toBe("48kHz / ≈96kbps");
    });

    it("Opus compressed, no duration → just sample rate", () => {
        const m = meta({
            container: "opus",
            sampleRate: 48000,
            sampleFormat: "compressed",
        });
        expect(formatSpec(m, undefined, undefined)).toBe("48kHz");
    });

    it("MIDI: format + tracks + tpq", () => {
        const m = meta({
            container: "mid",
            midiFormatType: 1,
            midiTrackCount: 12,
            midiDivision: 480,
        });
        expect(formatSpec(m, undefined, undefined)).toBe(
            "format 1 / 12 tracks / 480 tpq",
        );
    });

    it("MIDI: SMPTE division", () => {
        const m = meta({
            container: "mid",
            midiFormatType: 0,
            midiTrackCount: 1,
            midiDivision: -1,
        });
        expect(formatSpec(m, undefined, undefined)).toBe(
            "format 0 / 1 tracks / SMPTE timecode",
        );
    });

    it("decoder fallback supplies sample rate", () => {
        const m = meta({ bitDepth: 16, sampleFormat: "pcm-int" });
        expect(formatSpec(m, 48000, undefined)).toBe("48kHz / 16bit");
    });

    it("no sample rate and no qualifier → empty", () => {
        const m = meta({});
        expect(formatSpec(m, undefined, undefined)).toBe("");
    });
});
