import {
    type App,
    type McpUiHostContext,
    applyDocumentTheme,
    applyHostStyleVariables,
    applyHostFonts,
} from "@modelcontextprotocol/ext-apps";

export type Theme = "light" | "dark";

let current: Theme = "light";
const listeners = new Set<(t: Theme) => void>();

export function getTheme(): Theme {
    return current;
}

export function subscribeTheme(fn: (t: Theme) => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

function setTheme(t: Theme): void {
    if (t === current) return;
    current = t;
    applyDocumentTheme(t);
    for (const l of listeners) l(t);
}

function themeFrom(ctx: { theme?: Theme } | undefined): Theme {
    if (ctx?.theme === "dark") return "dark";
    if (ctx?.theme === "light") return "light";
    return current;
}

function applyHostStyles(ctx: McpUiHostContext | undefined): void {
    if (!ctx?.styles) return;
    if (ctx.styles.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

// Must be called before app.connect() resolves; the SDK rejects
// onhostcontextchanged handlers installed after connect.
export function wireTheme(app: App, connected: Promise<void>): void {
    app.onhostcontextchanged = (ctx) => {
        applyHostStyles(ctx);
        setTheme(themeFrom(ctx));
    };
    void connected.then(() => {
        const ctx = app.getHostContext();
        applyHostStyles(ctx);
        setTheme(themeFrom(ctx));
    });
}

// Test-only: reset module-level state between tests.
export function __resetThemeForTests(): void {
    current = "light";
    listeners.clear();
}
