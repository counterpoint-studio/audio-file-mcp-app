import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@modelcontextprotocol/ext-apps", () => ({
    applyDocumentTheme: vi.fn(),
}));

import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import {
    getTheme,
    subscribeTheme,
    wireTheme,
    __resetThemeForTests,
    type Theme,
} from "./theme";

const mockApply = vi.mocked(applyDocumentTheme);

interface FakeApp {
    onhostcontextchanged?: (ctx: { theme?: Theme } | undefined) => void;
    getHostContext: () => { theme?: Theme } | undefined;
}

beforeEach(() => {
    __resetThemeForTests();
    mockApply.mockReset();
});

describe("theme module", () => {
    it("defaults to light", () => {
        expect(getTheme()).toBe("light");
    });

    it("subscribeTheme returns an unsubscribe function", () => {
        const fn = vi.fn();
        const unsub = subscribeTheme(fn);
        expect(typeof unsub).toBe("function");
    });

    it("does not call subscribers on initial subscribe", () => {
        const fn = vi.fn();
        subscribeTheme(fn);
        expect(fn).not.toHaveBeenCalled();
    });

    it("notifies subscribers and applies the document theme on change", async () => {
        const fn = vi.fn();
        subscribeTheme(fn);
        const app: FakeApp = {
            getHostContext: () => ({ theme: "dark" }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();

        expect(fn).toHaveBeenCalledWith("dark");
        expect(getTheme()).toBe("dark");
        expect(mockApply).toHaveBeenCalledWith("dark");
    });

    it("does not re-notify when the theme is unchanged", async () => {
        const fn = vi.fn();
        subscribeTheme(fn);
        const app: FakeApp = {
            getHostContext: () => ({ theme: "light" }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(fn).not.toHaveBeenCalled();
        expect(mockApply).not.toHaveBeenCalled();
    });

    it("stops calling unsubscribed listeners", async () => {
        const fn = vi.fn();
        const unsub = subscribeTheme(fn);
        unsub();
        const app: FakeApp = {
            getHostContext: () => ({ theme: "dark" }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(fn).not.toHaveBeenCalled();
    });

    it("installs onhostcontextchanged synchronously, before connect resolves", () => {
        const app: FakeApp = {
            getHostContext: () => undefined,
        };
        let resolve!: () => void;
        const connected = new Promise<void>((r) => (resolve = r));
        wireTheme(app as never, connected);
        expect(typeof app.onhostcontextchanged).toBe("function");
        resolve();
    });

    it("reacts to onhostcontextchanged after connect", async () => {
        const fn = vi.fn();
        subscribeTheme(fn);
        const app: FakeApp = {
            getHostContext: () => undefined,
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();

        app.onhostcontextchanged!({ theme: "dark" });
        expect(fn).toHaveBeenCalledWith("dark");
        expect(getTheme()).toBe("dark");
        expect(mockApply).toHaveBeenLastCalledWith("dark");
    });

    it("keeps current theme when a partial host-context update omits theme", async () => {
        const fn = vi.fn();
        subscribeTheme(fn);
        const app: FakeApp = {
            getHostContext: () => ({ theme: "dark" }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();

        fn.mockClear();
        mockApply.mockClear();
        app.onhostcontextchanged!({});
        expect(fn).not.toHaveBeenCalled();
        expect(mockApply).not.toHaveBeenCalled();
        expect(getTheme()).toBe("dark");
    });

    it("applies the document theme before notifying subscribers", async () => {
        const order: string[] = [];
        mockApply.mockImplementation(() => {
            order.push("apply");
        });
        subscribeTheme(() => {
            order.push("listener");
        });
        const app: FakeApp = {
            getHostContext: () => ({ theme: "dark" }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(order).toEqual(["apply", "listener"]);
    });
});
