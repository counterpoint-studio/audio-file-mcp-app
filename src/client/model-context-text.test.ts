import { describe, it, expect } from "vitest";
import {
    buildContextMarkdown,
    emptyContextState,
    type ContextState,
} from "./model-context-text";
import type { AudioMetadata } from "./metadata";

function flacMeta(extra: Partial<AudioMetadata> = {}): AudioMetadata {
    return {
        container: "flac",
        sizeBytes: 12345678,
        channels: 2,
        sampleRate: 44100,
        bitrate: 940000,
        bitrateMode: "vbr",
        bitrateExact: false,
        duration: 213.42,
        durationExact: true,
        ...extra,
    };
}

describe("buildContextMarkdown", () => {
    it("returns empty string when path is null", () => {
        expect(buildContextMarkdown(emptyContextState())).toBe("");
    });

    it("renders a complete loaded state", () => {
        const state: ContextState = {
            path: "/abs/path/to/track.flac",
            metadata: flacMeta(),
            decoder: { channels: 2, sampleRate: 44100 },
            durationSeconds: 213.42,
            globalMetrics: {
                samplePeak: 0.871, // ≈ -1.2 dB
                rms: 0.121, // ≈ -18.3 dB
                truePeakDb: -0.8,
                integratedLufs: -14.1,
            },
            playback: "playing",
            positionSeconds: 42.51,
            positionSamples: { samplePeak: 0.676, rms: 0.155 },
            region: { startSeconds: 30, endSeconds: 60 },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("file: /abs/path/to/track.flac");
        expect(out).toContain("format: FLAC");
        expect(out).toContain("size-bytes: 12345678");
        expect(out).toContain("channels: 2");
        expect(out).toContain("sample-rate-hz: 44100");
        expect(out).toContain("bitrate-bps: 940000");
        expect(out).toContain("bitrate-mode: vbr");
        expect(out).toContain("duration-seconds: 213.42");
        expect(out).toContain("sample-peak-db: -1.2");
        expect(out).toContain("true-peak-db: -0.8");
        expect(out).toContain("rms-db: -18.3");
        expect(out).toContain("integrated-lufs: -14.1");
        expect(out).toContain("playback: playing");
        expect(out).toContain("position-seconds: 42.51");
        expect(out).toContain("position-sample-peak-db: -3.4");
        expect(out).toContain("position-rms-db: -16.2");
        expect(out).toContain("region-start-seconds: 30.00");
        expect(out).toContain("region-end-seconds: 60.00");
        expect(out).toMatch(/^---\n/);
        expect(out).toMatch(/\n---\n/);
        expect(out).toContain("track.flac");
        expect(out).toContain("region from 30.00 s to 60.00 s");
    });

    it("preserves stable frontmatter field order", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x/y.flac",
            metadata: flacMeta(),
            durationSeconds: 213.42,
            globalMetrics: {
                samplePeak: 0.5,
                rms: 0.1,
                truePeakDb: -1,
                integratedLufs: -14,
            },
            playback: "paused",
            region: { startSeconds: 1, endSeconds: 2 },
        };
        const out = buildContextMarkdown(state);
        const keys = out
            .split("\n")
            .filter((l) => /^[a-z-]+:/.test(l))
            .map((l) => l.slice(0, l.indexOf(":")));
        expect(keys).toEqual([
            "file",
            "format",
            "size-bytes",
            "channels",
            "sample-rate-hz",
            "bitrate-bps",
            "bitrate-mode",
            "duration-seconds",
            "sample-peak-db",
            "true-peak-db",
            "rms-db",
            "integrated-lufs",
            "playback",
            "position-seconds",
            "region-start-seconds",
            "region-end-seconds",
        ]);
    });

    it("renders 0 linear as -inf dB", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.wav",
            metadata: {
                container: "wav",
                sizeBytes: 100,
            },
            globalMetrics: {
                samplePeak: 0,
                rms: 0,
                truePeakDb: -Infinity,
                integratedLufs: -Infinity,
            },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("sample-peak-db: -inf");
        expect(out).toContain("true-peak-db: -inf");
        expect(out).toContain("rms-db: -inf");
        expect(out).toContain("integrated-lufs: -inf");
    });

    it("handles clipping (>1) sample-peak", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/clip.wav",
            metadata: { container: "wav", sizeBytes: 100 },
            globalMetrics: {
                samplePeak: 1.122, // ≈ +1.0 dB
                rms: 0.5,
                truePeakDb: 1.5,
                integratedLufs: -10,
            },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("sample-peak-db: 1.0");
    });

    it("omits optional metadata fields that are not present", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.wav",
            metadata: { container: "wav", sizeBytes: 100 }, // no channels, no sample rate, no bitrate
        };
        const out = buildContextMarkdown(state);
        expect(out).not.toContain("channels:");
        expect(out).not.toContain("sample-rate-hz:");
        expect(out).not.toContain("bitrate-bps:");
        expect(out).not.toContain("bitrate-mode:");
    });

    it("falls back to decoder values for channels and sample rate", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.flac",
            metadata: { container: "flac", sizeBytes: 100 },
            decoder: { channels: 2, sampleRate: 48000 },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("channels: 2");
        expect(out).toContain("sample-rate-hz: 48000");
    });

    it("omits region keys when no region selected", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.wav",
            metadata: { container: "wav", sizeBytes: 100 },
        };
        const out = buildContextMarkdown(state);
        expect(out).not.toContain("region-start-seconds:");
        expect(out).not.toContain("region-end-seconds:");
        expect(out).not.toContain("region from");
    });

    it("renders an unsupported-format error with no message", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.bin",
            metadata: { container: "wav", sizeBytes: 42 },
            error: { kind: "unsupported" },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("error: unsupported");
        expect(out).not.toContain("error-message:");
        expect(out).toContain("The file format is not supported.");
    });

    it("renders a decode-failed error with a message", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.mp3",
            metadata: { container: "mp3", sizeBytes: 50 },
            error: { kind: "decode-failed", message: "bad header" },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("error: decode-failed");
        expect(out).toContain('error-message: "bad header"');
        expect(out).toContain("The file could not be decoded (bad header).");
    });

    it("renders a playback-unsupported error", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.aac",
            metadata: { container: "aac", sizeBytes: 100 },
            error: { kind: "playback-unsupported", message: "source not supported" },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain("error: playback-unsupported");
        expect(out).toContain('error-message: "source not supported"');
        expect(out).toContain(
            "Playback of this file is not supported (source not supported).",
        );
    });

    it("sanitizes error messages with quotes and newlines", () => {
        const state: ContextState = {
            ...emptyContextState(),
            path: "/x.mp3",
            metadata: { container: "mp3", sizeBytes: 50 },
            error: { kind: "decode-failed", message: 'oops "bad"\nthing\there' },
        };
        const out = buildContextMarkdown(state);
        expect(out).toContain('error-message: "oops \\"bad\\" thing here"');
        // Body sentence uses the same sanitized form.
        expect(out).toContain(
            'The file could not be decoded (oops \\"bad\\" thing here).',
        );
    });

    it("distinguishes playing vs paused", () => {
        const base: ContextState = {
            ...emptyContextState(),
            path: "/x.wav",
            metadata: { container: "wav", sizeBytes: 100 },
        };
        expect(buildContextMarkdown({ ...base, playback: "playing" })).toContain(
            "playback: playing",
        );
        expect(buildContextMarkdown({ ...base, playback: "paused" })).toContain(
            "playback: paused",
        );
    });
});
