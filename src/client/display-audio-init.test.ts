import { describe, expect, it } from "vitest";
import { parseDisplayAudioInit } from "./display-audio-init";

describe("parseDisplayAudioInit", () => {
    it("returns path-only when only text content is present", () => {
        const init = parseDisplayAudioInit({
            content: [{ type: "text", text: "/a/b.wav" }],
        });
        expect(init).toEqual({ path: "/a/b.wav" });
    });

    it("prefers structuredContent.path over text content", () => {
        const init = parseDisplayAudioInit({
            content: [{ type: "text", text: "/x.wav" }],
            structuredContent: { path: "/y.wav" },
        });
        expect(init?.path).toBe("/y.wav");
    });

    it("reads playheadSeconds and region when valid", () => {
        const init = parseDisplayAudioInit({
            structuredContent: {
                path: "/a.wav",
                playheadSeconds: 1.5,
                region: { startSeconds: 2, endSeconds: 4 },
            },
        });
        expect(init).toEqual({
            path: "/a.wav",
            playheadSeconds: 1.5,
            region: { startSeconds: 2, endSeconds: 4 },
        });
    });

    it("drops negative playheadSeconds", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", playheadSeconds: -1 },
        });
        expect(init?.playheadSeconds).toBeUndefined();
    });

    it("drops non-finite playheadSeconds", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", playheadSeconds: Number.NaN },
        });
        expect(init?.playheadSeconds).toBeUndefined();
    });

    it("drops region when end <= start", () => {
        const init = parseDisplayAudioInit({
            structuredContent: {
                path: "/a.wav",
                region: { startSeconds: 3, endSeconds: 3 },
            },
        });
        expect(init?.region).toBeUndefined();
    });

    it("drops region when start is negative", () => {
        const init = parseDisplayAudioInit({
            structuredContent: {
                path: "/a.wav",
                region: { startSeconds: -1, endSeconds: 2 },
            },
        });
        expect(init?.region).toBeUndefined();
    });

    it("drops region when fields are non-numeric", () => {
        const init = parseDisplayAudioInit({
            structuredContent: {
                path: "/a.wav",
                region: { startSeconds: "0", endSeconds: 2 },
            },
        });
        expect(init?.region).toBeUndefined();
    });

    it("reads sizeBytes when it's a non-negative integer", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", sizeBytes: 12345 },
        });
        expect(init?.sizeBytes).toBe(12345);
    });

    it("drops sizeBytes when negative", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", sizeBytes: -1 },
        });
        expect(init?.sizeBytes).toBeUndefined();
    });

    it("drops sizeBytes when non-integer", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", sizeBytes: 3.5 },
        });
        expect(init?.sizeBytes).toBeUndefined();
    });

    it("drops sizeBytes when non-finite", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", sizeBytes: Number.NaN },
        });
        expect(init?.sizeBytes).toBeUndefined();
    });

    it("parses valid annotations from structuredContent", () => {
        const init = parseDisplayAudioInit({
            structuredContent: {
                path: "/a.wav",
                annotations: {
                    lanes: [{ label: "Pad", spans: [{ start: 0, end: 5 }] }],
                },
            },
        });
        expect(init?.annotations).toEqual({
            lanes: [{ label: "Pad", spans: [{ start: 0, end: 5 }] }],
        });
    });

    it("drops invalid annotations", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav", annotations: { lanes: 5 } },
        });
        expect(init?.annotations).toBeUndefined();
    });

    it("leaves annotations undefined when absent", () => {
        const init = parseDisplayAudioInit({
            structuredContent: { path: "/a.wav" },
        });
        expect(init?.annotations).toBeUndefined();
    });

    it("returns null when no path can be found", () => {
        expect(parseDisplayAudioInit({})).toBeNull();
        expect(parseDisplayAudioInit({ content: [] })).toBeNull();
        expect(
            parseDisplayAudioInit({ structuredContent: { path: "" } }),
        ).toBeNull();
    });
});
