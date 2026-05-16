export type DisplayAudioInit = {
    path: string;
    sizeBytes?: number;
    playheadSeconds?: number;
    region?: { startSeconds: number; endSeconds: number };
};

type ToolResultLike = {
    content?: ReadonlyArray<{ type?: string; text?: string }> | undefined;
    structuredContent?: Record<string, unknown> | undefined;
};

export function parseDisplayAudioInit(
    result: ToolResultLike,
): DisplayAudioInit | null {
    const path = pickPath(result);
    if (!path) return null;

    const sc = result.structuredContent;
    const init: DisplayAudioInit = { path };
    if (!sc || typeof sc !== "object") return init;

    const sz = sc.sizeBytes;
    if (
        typeof sz === "number" &&
        Number.isFinite(sz) &&
        sz >= 0 &&
        Number.isInteger(sz)
    ) {
        init.sizeBytes = sz;
    }

    const ph = sc.playheadSeconds;
    if (typeof ph === "number" && Number.isFinite(ph) && ph >= 0) {
        init.playheadSeconds = ph;
    }

    const region = sc.region;
    if (region && typeof region === "object") {
        const r = region as Record<string, unknown>;
        const a = r.startSeconds;
        const b = r.endSeconds;
        if (
            typeof a === "number" &&
            typeof b === "number" &&
            Number.isFinite(a) &&
            Number.isFinite(b) &&
            a >= 0 &&
            b > a
        ) {
            init.region = { startSeconds: a, endSeconds: b };
        }
    }

    return init;
}

function pickPath(result: ToolResultLike): string | null {
    const sc = result.structuredContent;
    if (sc && typeof sc.path === "string" && sc.path.length > 0) {
        return sc.path;
    }
    const text = result.content?.find((c) => c?.type === "text")?.text;
    return text && text.length > 0 ? text : null;
}
