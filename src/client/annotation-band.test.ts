import { describe, it, expect } from "vitest";
import { sanitizeColor } from "./annotation-band";

describe("sanitizeColor", () => {
    it("returns null for undefined/empty", () => {
        expect(sanitizeColor(undefined)).toBeNull();
        expect(sanitizeColor("")).toBeNull();
        expect(sanitizeColor("   ")).toBeNull();
    });

    it("accepts hex colors", () => {
        expect(sanitizeColor("#fff")).toBe("#fff");
        expect(sanitizeColor("#ff8800")).toBe("#ff8800");
        expect(sanitizeColor("  #3af  ")).toBe("#3af");
        expect(sanitizeColor("#11223344")).toBe("#11223344");
    });

    it("accepts named colors", () => {
        expect(sanitizeColor("rebeccapurple")).toBe("rebeccapurple");
        expect(sanitizeColor("red")).toBe("red");
    });

    it("accepts rgb/hsl functional colors", () => {
        expect(sanitizeColor("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
        expect(sanitizeColor("rgba(0,0,0,0.5)")).toBe("rgba(0,0,0,0.5)");
        expect(sanitizeColor("hsl(120, 50%, 50%)")).toBe("hsl(120, 50%, 50%)");
    });

    it("rejects colors carrying injection-prone characters", () => {
        expect(sanitizeColor("red; background: url(x)")).toBeNull();
        expect(sanitizeColor("url(#evil)")).toBeNull();
        expect(sanitizeColor("</style>")).toBeNull();
        expect(sanitizeColor("expression(alert(1))")).toBeNull();
        expect(sanitizeColor("#zzz")).toBeNull();
    });
});
