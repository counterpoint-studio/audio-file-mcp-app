import { describe, it, expect } from "vitest";
import { normalizeIncomingPath } from "./path-utils";

describe("normalizeIncomingPath", () => {
    describe("passes plain paths through unchanged", () => {
        it("POSIX path", () => {
            expect(normalizeIncomingPath("/Users/me/song.mp3")).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("POSIX path with spaces", () => {
            expect(
                normalizeIncomingPath("/Users/me/My Music/song one.mp3"),
            ).toBe("/Users/me/My Music/song one.mp3");
        });

        it("Windows path", () => {
            expect(normalizeIncomingPath("C:\\Users\\me\\song.mp3")).toBe(
                "C:\\Users\\me\\song.mp3",
            );
        });

        it("UNC path", () => {
            expect(
                normalizeIncomingPath("\\\\server\\share\\file.mp3"),
            ).toBe("\\\\server\\share\\file.mp3");
        });
    });

    describe("strips surrounding quotes", () => {
        it("single quotes (the reported bug)", () => {
            expect(
                normalizeIncomingPath(
                    "'/Users/me/Rimrock Elemental+Gratitud - medium.mp3'",
                ),
            ).toBe("/Users/me/Rimrock Elemental+Gratitud - medium.mp3");
        });

        it("double quotes", () => {
            expect(normalizeIncomingPath('"/Users/me/song.mp3"')).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("backticks", () => {
            expect(normalizeIncomingPath("`/Users/me/song.mp3`")).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("curly single quotes", () => {
            expect(normalizeIncomingPath("‘/Users/me/song.mp3’")).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("curly double quotes", () => {
            expect(normalizeIncomingPath("“/Users/me/song.mp3”")).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("German low-9 single quotes", () => {
            expect(normalizeIncomingPath("‚/Users/me/song.mp3’")).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("German low-9 double quotes", () => {
            expect(normalizeIncomingPath("„/Users/me/song.mp3”")).toBe(
                "/Users/me/song.mp3",
            );
        });
    });

    describe("trims whitespace", () => {
        it("leading and trailing spaces", () => {
            expect(normalizeIncomingPath("   /Users/me/song.mp3   ")).toBe(
                "/Users/me/song.mp3",
            );
        });

        it("tabs and newlines", () => {
            expect(
                normalizeIncomingPath("\t/Users/me/song.mp3\n"),
            ).toBe("/Users/me/song.mp3");
        });
    });

    describe("nested wrappers", () => {
        it("whitespace around quotes", () => {
            expect(
                normalizeIncomingPath("  '/Users/me/song.mp3'  "),
            ).toBe("/Users/me/song.mp3");
        });

        it("quotes inside whitespace inside quotes", () => {
            expect(
                normalizeIncomingPath("  ' \"/Users/me/song.mp3\" '  "),
            ).toBe("/Users/me/song.mp3");
        });
    });

    describe("does not strip mismatched or stray quotes", () => {
        it("mismatched single + double", () => {
            expect(normalizeIncomingPath("'/Users/me/song.mp3\"")).toBe(
                "'/Users/me/song.mp3\"",
            );
        });

        it("stray leading quote", () => {
            expect(normalizeIncomingPath("'/Users/me/song.mp3")).toBe(
                "'/Users/me/song.mp3",
            );
        });

        it("stray trailing quote", () => {
            expect(normalizeIncomingPath("/Users/me/song.mp3'")).toBe(
                "/Users/me/song.mp3'",
            );
        });
    });

    describe("preserves quote characters inside the filename", () => {
        it("unquoted path with apostrophe", () => {
            expect(normalizeIncomingPath("/Users/me/Don't Stop.mp3")).toBe(
                "/Users/me/Don't Stop.mp3",
            );
        });

        it("single-quoted path containing an apostrophe", () => {
            expect(
                normalizeIncomingPath("'/Users/me/Don't Stop.mp3'"),
            ).toBe("/Users/me/Don't Stop.mp3");
        });
    });

    describe("file:// URIs", () => {
        it("POSIX-style file URL", () => {
            expect(
                normalizeIncomingPath("file:///Users/me/song.mp3"),
            ).toBe("/Users/me/song.mp3");
        });

        it("Windows-style file URL with drive letter", () => {
            expect(
                normalizeIncomingPath("file:///C:/Users/me/song.mp3"),
            ).toBe("C:/Users/me/song.mp3");
        });

        it("percent-encoded spaces", () => {
            expect(
                normalizeIncomingPath(
                    "file:///Users/me/Rimrock%20Elemental.mp3",
                ),
            ).toBe("/Users/me/Rimrock Elemental.mp3");
        });

        it("quoted file URL", () => {
            expect(
                normalizeIncomingPath(
                    "'file:///Users/me/Rimrock%20Elemental.mp3'",
                ),
            ).toBe("/Users/me/Rimrock Elemental.mp3");
        });
    });

    describe("idempotence", () => {
        const samples = [
            "/Users/me/song.mp3",
            "'/Users/me/Rimrock Elemental+Gratitud - medium.mp3'",
            "  ' \"/Users/me/song.mp3\" '  ",
            "file:///Users/me/Rimrock%20Elemental.mp3",
            "C:\\Users\\me\\song.mp3",
        ];
        for (const input of samples) {
            it(`stable for ${JSON.stringify(input)}`, () => {
                const once = normalizeIncomingPath(input);
                const twice = normalizeIncomingPath(once);
                expect(twice).toBe(once);
            });
        }
    });

    describe("empty input", () => {
        it("empty string", () => {
            expect(normalizeIncomingPath("")).toBe("");
        });

        it("whitespace only", () => {
            expect(normalizeIncomingPath("   \n\t  ")).toBe("");
        });

        it("just quotes around whitespace", () => {
            expect(normalizeIncomingPath("'   '")).toBe("");
        });
    });
});
