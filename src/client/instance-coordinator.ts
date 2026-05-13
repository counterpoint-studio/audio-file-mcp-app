import type { App } from "@modelcontextprotocol/ext-apps";
import {
    buildCombinedContextMarkdown,
    compareKeys,
    emptyContextState,
    type CombinedEntry,
    type ContextState,
    type InstanceKey,
} from "./model-context-text";
import {
    createThrottledPublisher,
    type ThrottledPublisher,
    type ThrottledPublisherOpts,
} from "./throttled-publisher";

export type CoordinatorMessage =
    | {
          kind: "state";
          instanceId: string;
          key: InstanceKey;
          state: ContextState;
      }
    | { kind: "goodbye"; instanceId: string };

export type InstanceCoordinator = {
    setKey(key: { createdAt: number; seq: number }): void;
    submitLocal(state: ContextState): void;
    destroy(): void;
};

type ChannelLike = {
    postMessage(m: unknown): void;
    close(): void;
    onmessage: ((ev: { data: unknown }) => void) | null;
};

export type InstanceCoordinatorOpts = {
    channelName?: string;
    heartbeatMs?: number;
    ttlMs?: number;
    publishMinIntervalMs?: number;
    logError?: (e: unknown) => void;
    channelFactory?: (name: string) => ChannelLike;
    now?: () => number;
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (id: unknown) => void;
    timer?: Pick<ThrottledPublisherOpts, "now" | "setTimer" | "clearTimer">;
    randomInstanceId?: () => string;
};

type UpdateModelContextApp = Pick<App, "updateModelContext">;

export function createInstanceCoordinator(
    app: UpdateModelContextApp,
    opts: InstanceCoordinatorOpts = {},
): InstanceCoordinator {
    const heartbeatMs = opts.heartbeatMs ?? 1000;
    const ttlMs = opts.ttlMs ?? heartbeatMs * 3;
    const publishMinIntervalMs = opts.publishMinIntervalMs ?? 100;
    const channelName = opts.channelName ?? "audiofile-mcp-app:instances";
    const logError =
        opts.logError ??
        ((e: unknown) => console.warn("instance coordinator failed", e));
    const nowFn = opts.now ?? (() => Date.now());
    const setIntervalImpl =
        opts.setInterval ??
        ((fn: () => void, ms: number) => setInterval(fn, ms) as unknown);
    const clearIntervalImpl =
        opts.clearInterval ??
        ((id) => clearInterval(id as ReturnType<typeof setInterval>));
    const channelFactory =
        opts.channelFactory ??
        ((name: string) => new BroadcastChannel(name) as unknown as ChannelLike);
    const randomInstanceId =
        opts.randomInstanceId ?? (() => crypto.randomUUID());

    const instanceId = randomInstanceId();
    const channel = channelFactory(channelName);

    let myKey: { createdAt: number; seq: number } | null = null;
    let localState: ContextState | null = null;
    let lastBroadcastAt = -Infinity;
    let destroyed = false;

    type RosterEntry = {
        key: InstanceKey;
        state: ContextState;
        lastHeardAt: number;
    };
    const roster = new Map<string, RosterEntry>();

    function selfKey(): InstanceKey | null {
        if (!myKey) return null;
        return { createdAt: myKey.createdAt, seq: myKey.seq, instanceId };
    }

    function selfEntry(): CombinedEntry | null {
        const k = selfKey();
        if (!k) return null;
        return { key: k, state: localState ?? emptyContextState() };
    }

    function broadcastState(): void {
        if (destroyed) return;
        const k = selfKey();
        if (!k || !localState) return;
        try {
            const msg: CoordinatorMessage = {
                kind: "state",
                instanceId,
                key: k,
                state: localState,
            };
            channel.postMessage(msg);
            lastBroadcastAt = nowFn();
        } catch (e) {
            logError(e);
        }
    }

    function pruneRoster(): boolean {
        const cutoff = nowFn() - ttlMs;
        let changed = false;
        for (const [id, entry] of roster) {
            if (entry.lastHeardAt < cutoff) {
                roster.delete(id);
                changed = true;
            }
        }
        return changed;
    }

    function isReporter(): boolean {
        const self = selfEntry();
        if (!self) return false;
        let best = self;
        for (const e of roster.values()) {
            const cand: CombinedEntry = { key: e.key, state: e.state };
            if (compareKeys(cand, best) < 0) best = cand;
        }
        return best.key.instanceId === instanceId;
    }

    function doPublish(): void {
        if (destroyed) return;
        if (!isReporter()) return;
        const entries: CombinedEntry[] = [];
        const self = selfEntry();
        if (self) entries.push(self);
        for (const e of roster.values()) {
            entries.push({ key: e.key, state: e.state });
        }
        const text = buildCombinedContextMarkdown(entries);
        if (!text) return;
        try {
            const result = app.updateModelContext({
                content: [{ type: "text", text }],
            });
            const m = result as unknown;
            if (m && typeof (m as { catch?: unknown }).catch === "function") {
                (m as Promise<unknown>).catch(logError);
            }
        } catch (e) {
            logError(e);
        }
    }

    const throttle: ThrottledPublisher = createThrottledPublisher({
        minIntervalMs: publishMinIntervalMs,
        send: doPublish,
        ...(opts.timer ?? {}),
    });

    function scheduleRepublish(immediate: boolean): void {
        if (destroyed) return;
        if (!myKey) return;
        throttle.publish(immediate);
    }

    channel.onmessage = (ev) => {
        if (destroyed) return;
        const msg = ev.data as CoordinatorMessage | null | undefined;
        if (!msg || typeof msg !== "object") return;
        if (msg.kind === "state") {
            if (msg.instanceId === instanceId) return;
            roster.set(msg.instanceId, {
                key: msg.key,
                state: msg.state,
                lastHeardAt: nowFn(),
            });
            scheduleRepublish(false);
        } else if (msg.kind === "goodbye") {
            if (msg.instanceId === instanceId) return;
            if (roster.delete(msg.instanceId)) {
                scheduleRepublish(false);
            }
        }
    };

    function onTick(): void {
        if (destroyed) return;
        if (pruneRoster()) {
            scheduleRepublish(false);
        }
        if (
            myKey &&
            localState &&
            nowFn() - lastBroadcastAt >= heartbeatMs
        ) {
            broadcastState();
        }
    }

    const tickId = setIntervalImpl(onTick, heartbeatMs);

    return {
        setKey(key) {
            if (destroyed) return;
            if (myKey) return;
            myKey = { createdAt: key.createdAt, seq: key.seq };
            if (localState) broadcastState();
            scheduleRepublish(true);
        },
        submitLocal(state) {
            if (destroyed) return;
            localState = state;
            if (!myKey) return;
            broadcastState();
            scheduleRepublish(true);
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            try {
                const goodbye: CoordinatorMessage = {
                    kind: "goodbye",
                    instanceId,
                };
                channel.postMessage(goodbye);
            } catch (e) {
                logError(e);
            }
            try {
                channel.close();
            } catch (e) {
                logError(e);
            }
            clearIntervalImpl(tickId);
            throttle.destroy();
        },
    };
}
