import type { App } from "@modelcontextprotocol/ext-apps";
import {
    buildContextMarkdown,
    emptyContextState,
    type ContextState,
    type GlobalMetrics,
    type PositionSamples,
} from "./model-context-text";
import type { AudioMetadata } from "./metadata";
import {
    createThrottledPublisher,
    type ThrottledPublisher,
    type ThrottledPublisherOpts,
} from "./throttled-publisher";

export type AudioContextPublisher = {
    setFile(path: string): void;
    setMetadata(m: AudioMetadata | null): void;
    setDecoderInfo(d: { channels?: number; sampleRate?: number }): void;
    setDurationSeconds(d: number | null): void;
    setGlobalMetrics(m: GlobalMetrics | null): void;
    setPlayback(p: "playing" | "paused"): void;
    setPosition(seconds: number, samples: PositionSamples | null): void;
    setRegionPreview(startSec: number, endSec: number): void;
    setRegion(startSec: number, endSec: number): void;
    clearRegion(): void;
    destroy(): void;
};

export type AudioContextPublisherOpts = {
    minIntervalMs?: number;
    logError?: (e: unknown) => void;
    timer?: Pick<ThrottledPublisherOpts, "now" | "setTimer" | "clearTimer">;
};

type UpdateModelContextApp = Pick<App, "updateModelContext">;

export function createAudioContextPublisher(
    app: UpdateModelContextApp,
    opts: AudioContextPublisherOpts = {},
): AudioContextPublisher {
    const minIntervalMs = opts.minIntervalMs ?? 1000;
    const logError = opts.logError ?? ((e: unknown) => console.warn("updateModelContext failed", e));

    const state: ContextState = emptyContextState();
    let destroyed = false;

    const send = (): void => {
        const text = buildContextMarkdown(state);
        if (!text) return;
        try {
            const result = app.updateModelContext({ content: [{ type: "text", text }] });
            const maybe = result as unknown;
            if (maybe && typeof (maybe as { catch?: unknown }).catch === "function") {
                (maybe as Promise<unknown>).catch(logError);
            }
        } catch (e) {
            logError(e);
        }
    };

    const publisher: ThrottledPublisher = createThrottledPublisher({
        minIntervalMs,
        send,
        ...(opts.timer ?? {}),
    });

    function guard(): boolean {
        return destroyed;
    }

    return {
        setFile(path: string): void {
            if (guard()) return;
            state.path = path;
            publisher.publish(true);
        },
        setMetadata(m: AudioMetadata | null): void {
            if (guard()) return;
            state.metadata = m;
            publisher.publish(true);
        },
        setDecoderInfo(d: { channels?: number; sampleRate?: number }): void {
            if (guard()) return;
            state.decoder = { ...d };
            publisher.publish(true);
        },
        setDurationSeconds(d: number | null): void {
            if (guard()) return;
            state.durationSeconds = d;
            publisher.publish(true);
        },
        setGlobalMetrics(m: GlobalMetrics | null): void {
            if (guard()) return;
            state.globalMetrics = m;
            publisher.publish(true);
        },
        setPlayback(p: "playing" | "paused"): void {
            if (guard()) return;
            const wasPlaying = state.playback === "playing";
            state.playback = p;
            // When pausing, flush any pending trailing position publish so the
            // final position is sent immediately.
            if (wasPlaying && p === "paused") {
                publisher.publish(true);
            } else {
                publisher.publish(true);
            }
        },
        setPosition(seconds: number, samples: PositionSamples | null): void {
            if (guard()) return;
            const prevRounded = roundSeconds(state.positionSeconds);
            const nextRounded = roundSeconds(seconds);
            state.positionSeconds = seconds;
            state.positionSamples = samples;
            // Skip wakeup if the position rounds the same and no samples-only
            // change happened that would matter at 1-decimal dB resolution.
            // We rely on the throttle: send() always builds the latest state.
            if (prevRounded === nextRounded && samples === null) {
                return;
            }
            publisher.publish(false);
        },
        setRegionPreview(startSec: number, endSec: number): void {
            if (guard()) return;
            state.region = { startSeconds: startSec, endSeconds: endSec };
            publisher.publish(false);
        },
        setRegion(startSec: number, endSec: number): void {
            if (guard()) return;
            state.region = { startSeconds: startSec, endSeconds: endSec };
            publisher.publish(true);
        },
        clearRegion(): void {
            if (guard()) return;
            state.region = null;
            publisher.publish(true);
        },
        destroy(): void {
            destroyed = true;
            publisher.destroy();
        },
    };
}

function roundSeconds(s: number): number {
    if (!Number.isFinite(s)) return 0;
    return Math.round(s * 100);
}
