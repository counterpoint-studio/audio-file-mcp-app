import { describe, it, expect } from "vitest";
import { resolveAnnotations } from "./resolve-annotations.js";

const valid = { lanes: [{ label: "A", spans: [{ start: 0, end: 5 }] }] };

function reader(map: Record<string, string>): (p: string) => Promise<string> {
    return async (p) => {
        if (!(p in map)) throw new Error(`ENOENT: ${p}`);
        return map[p];
    };
}

const failReader: (p: string) => Promise<string> = async () => {
    throw new Error("readFile should not be called");
};

describe("resolveAnnotations", () => {
    it("returns null when neither input is present", async () => {
        expect(await resolveAnnotations({}, failReader)).toBeNull();
    });

    it("validates and returns inline annotations", async () => {
        const out = await resolveAnnotations({ annotations: valid }, failReader);
        expect(out).toEqual(valid);
    });

    it("throws on schema-invalid inline annotations", async () => {
        await expect(
            resolveAnnotations({ annotations: { lanes: "nope" } }, failReader),
        ).rejects.toThrow(/invalid annotations/);
    });

    it("reads, parses, and validates a file path", async () => {
        const out = await resolveAnnotations(
            { annotationsPath: "/tmp/a.json" },
            reader({ "/tmp/a.json": JSON.stringify(valid) }),
        );
        expect(out).toEqual(valid);
    });

    it("normalizes a wrapped/file-scheme path before reading", async () => {
        const out = await resolveAnnotations(
            { annotationsPath: '"/tmp/a.json"' },
            reader({ "/tmp/a.json": JSON.stringify(valid) }),
        );
        expect(out).toEqual(valid);
    });

    it("throws a clear error on invalid JSON in the file", async () => {
        await expect(
            resolveAnnotations(
                { annotationsPath: "/tmp/bad.json" },
                reader({ "/tmp/bad.json": "{ not json" }),
            ),
        ).rejects.toThrow(/not valid JSON/);
    });

    it("throws on schema-invalid file contents", async () => {
        await expect(
            resolveAnnotations(
                { annotationsPath: "/tmp/wrong.json" },
                reader({ "/tmp/wrong.json": JSON.stringify({ lanes: 5 }) }),
            ),
        ).rejects.toThrow(/invalid annotations/);
    });

    it("prefers inline annotations over a path (path reader not called)", async () => {
        const out = await resolveAnnotations(
            { annotations: valid, annotationsPath: "/tmp/ignored.json" },
            failReader,
        );
        expect(out).toEqual(valid);
    });
});
