import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@modelcontextprotocol/ext-apps", () => ({
    applyDocumentTheme: vi.fn(),
    applyHostStyleVariables: vi.fn(),
    applyHostFonts: vi.fn(),
}));

import {
    applyDocumentTheme,
    applyHostStyleVariables,
    applyHostFonts,
} from "@modelcontextprotocol/ext-apps";
import {
    getTheme,
    subscribeTheme,
    wireTheme,
    __resetThemeForTests,
    type Theme,
} from "./theme";

const mockApply = vi.mocked(applyDocumentTheme);
const mockApplyVars = vi.mocked(applyHostStyleVariables);
const mockApplyFonts = vi.mocked(applyHostFonts);

interface FakeHostContext {
    theme?: Theme;
    styles?: {
        variables?: Record<string, string>;
        css?: { fonts?: string };
    };
}

interface FakeApp {
    onhostcontextchanged?: (ctx: FakeHostContext | undefined) => void;
    getHostContext: () => FakeHostContext | undefined;
}

beforeEach(() => {
    __resetThemeForTests();
    mockApply.mockReset();
    mockApplyVars.mockReset();
    mockApplyFonts.mockReset();
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

    it("applies host style variables when present in initial context", async () => {
        const variables = { "--color-text-primary": "#123456" };
        const app: FakeApp = {
            getHostContext: () => ({ styles: { variables } }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(mockApplyVars).toHaveBeenCalledWith(variables);
    });

    it("applies host fonts when present in initial context", async () => {
        const fontCss = "@font-face { font-family: x; src: url(y); }";
        const app: FakeApp = {
            getHostContext: () => ({ styles: { css: { fonts: fontCss } } }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(mockApplyFonts).toHaveBeenCalledWith(fontCss);
    });

    it("does not call host-style helpers when styles is absent", async () => {
        const app: FakeApp = {
            getHostContext: () => ({ theme: "dark" }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(mockApplyVars).not.toHaveBeenCalled();
        expect(mockApplyFonts).not.toHaveBeenCalled();
    });

    it("re-applies host styles on every onhostcontextchanged carrying styles", async () => {
        const app: FakeApp = {
            getHostContext: () => undefined,
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();

        const vars1 = { "--color-text-primary": "#111" };
        app.onhostcontextchanged!({ styles: { variables: vars1 } });
        expect(mockApplyVars).toHaveBeenLastCalledWith(vars1);

        const vars2 = { "--color-text-primary": "#222" };
        app.onhostcontextchanged!({ styles: { variables: vars2 } });
        expect(mockApplyVars).toHaveBeenLastCalledWith(vars2);
        expect(mockApplyVars).toHaveBeenCalledTimes(2);
    });

    it("applies host styles before notifying theme subscribers", async () => {
        const order: string[] = [];
        mockApplyVars.mockImplementation(() => {
            order.push("vars");
        });
        mockApply.mockImplementation(() => {
            order.push("theme");
        });
        subscribeTheme(() => {
            order.push("listener");
        });
        const app: FakeApp = {
            getHostContext: () => ({
                theme: "dark",
                styles: { variables: { "--color-text-primary": "#fff" } },
            }),
        };
        wireTheme(app as never, Promise.resolve());
        await Promise.resolve();
        expect(order).toEqual(["vars", "theme", "listener"]);
    });
});
