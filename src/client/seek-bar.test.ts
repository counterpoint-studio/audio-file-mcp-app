import { describe, it, expect } from "vitest";
import { gestureKind } from "./seek-bar";

describe("gestureKind", () => {
    it("returns click when movement is below threshold", () => {
        expect(gestureKind(100, 102, 4)).toBe("click");
        expect(gestureKind(100, 100, 4)).toBe("click");
        expect(gestureKind(100, 97, 4)).toBe("click");
    });
    it("returns drag at or above threshold", () => {
        expect(gestureKind(100, 104, 4)).toBe("drag");
        expect(gestureKind(100, 96, 4)).toBe("drag");
        expect(gestureKind(100, 200, 4)).toBe("drag");
    });
});
