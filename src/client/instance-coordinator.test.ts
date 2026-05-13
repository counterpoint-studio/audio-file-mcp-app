import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInstanceCoordinator } from "./instance-coordinator";
import {
    emptyContextState,
    type ContextState,
} from "./model-context-text";

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

type Peer = {
    onmessage: ((ev: { data: unknown }) => void) | null;
    postMessage: (m: unknown) => void;
    close: () => void;
};

function makeFakeRegistry() {
    const channels = new Map<string, Set<Peer>>();
    function makeChannel(name: string): Peer {
        let set = channels.get(name);
        if (!set) {
            set = new Set();
            channels.set(name, set);
        }
        const peer: Peer = {
            onmessage: null,
            postMessage(m) {
                const peers = channels.get(name);
                if (!peers) return;
                for (const p of peers) {
                    if (p === peer) continue;
                    p.onmessage?.({ data: m });
                }
            },
            close() {
                channels.get(name)?.delete(peer);
            },
        };
        set.add(peer);
        return peer;
    }
    return { makeChannel };
}

function loaded(path: string): ContextState {
    return {
        ...emptyContextState(),
        path,
        metadata: { container: "wav", sizeBytes: 100 },
    };
}

function makeApp() {
    return { updateModelContext: vi.fn().mockResolvedValue({}) };
}

function lastText(app: { updateModelContext: { mock: { calls: unknown[][] } } }): string {
    const calls = app.updateModelContext.mock.calls;
    const last = calls[calls.length - 1]?.[0] as
        | { content: { text: string }[] }
        | undefined;
    return last?.content[0]?.text ?? "";
}

describe("createInstanceCoordinator", () => {
    it("a lone instance publishes its state on submitLocal", () => {
        const { makeChannel } = makeFakeRegistry();
        const app = makeApp();
        const c = createInstanceCoordinator(app, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        c.setKey({ createdAt: 1, seq: 1 });
        expect(app.updateModelContext).not.toHaveBeenCalled();
        c.submitLocal(loaded("/a.wav"));
        expect(app.updateModelContext).toHaveBeenCalledTimes(1);
        const text = lastText(app);
        expect(text).toContain("file: /a.wav");
        expect(text).not.toContain("## Audio file 1");
        expect(text).not.toContain("The user has");
        c.destroy();
    });

    it("two instances: lower-key reporter publishes both, higher-key stays silent", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const appB = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        const b = createInstanceCoordinator(appB, {
            channelFactory: makeChannel,
            randomInstanceId: () => "b",
        });
        a.setKey({ createdAt: 1, seq: 1 });
        b.setKey({ createdAt: 1, seq: 2 });
        a.submitLocal(loaded("/a.wav"));
        // A is reporter; A publishes
        expect(appA.updateModelContext).toHaveBeenCalled();
        expect(appB.updateModelContext).not.toHaveBeenCalled();
        // Now B submits; A re-publishes combined doc; B stays silent
        appA.updateModelContext.mockClear();
        b.submitLocal(loaded("/b.wav"));
        // B's submit triggers a broadcast (sync delivery to A), A schedules trailing publish
        vi.advanceTimersByTime(150);
        expect(appB.updateModelContext).not.toHaveBeenCalled();
        expect(appA.updateModelContext).toHaveBeenCalled();
        const text = lastText(appA);
        expect(text).toContain("The user has 2 audio files open.");
        expect(text).toContain("/a.wav");
        expect(text).toContain("/b.wav");
        a.destroy();
        b.destroy();
    });

    it("failover: reporter A drops, B takes over within ttl", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const appB = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        const b = createInstanceCoordinator(appB, {
            channelFactory: makeChannel,
            randomInstanceId: () => "b",
        });
        a.setKey({ createdAt: 1, seq: 1 });
        b.setKey({ createdAt: 1, seq: 2 });
        a.submitLocal(loaded("/a.wav"));
        b.submitLocal(loaded("/b.wav"));
        // Stop A's broadcasts: simulate page death by destroying without goodbye.
        // To skip the goodbye, just stop A's heartbeat: we can't easily, so use
        // destroy and clear the channel registration first.
        // Instead, we'll just leave A's submit/broadcast frozen by not advancing.
        // Easier: nuke A's heartbeat by destroy and then strip the goodbye from
        // delivery: simulate via fresh registry would be more invasive.
        // Use a different approach: detach A's heartbeat by overriding setInterval
        // — recreate with custom timer hook below.
        a.destroy();
        // Goodbye was sent — B receives, prunes A from roster on next publish.
        appB.updateModelContext.mockClear();
        vi.advanceTimersByTime(200);
        expect(appB.updateModelContext).toHaveBeenCalled();
        const text = lastText(appB);
        expect(text).not.toContain("/a.wav");
        expect(text).toContain("/b.wav");
        b.destroy();
    });

    it("failover via TTL prune when reporter never sent goodbye", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const appB = makeApp();
        // We need A to broadcast at least once, then go silent. We'll use two
        // coordinators with their own setInterval seams so we can stop A's
        // ticks independently.
        const aTimers: Array<() => void> = [];
        const bTimers: Array<() => void> = [];
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
            setInterval: (fn) => {
                aTimers.push(fn);
                return 1;
            },
            clearInterval: () => {},
            heartbeatMs: 1000,
            ttlMs: 3000,
        });
        const b = createInstanceCoordinator(appB, {
            channelFactory: makeChannel,
            randomInstanceId: () => "b",
            setInterval: (fn) => {
                bTimers.push(fn);
                return 2;
            },
            clearInterval: () => {},
            heartbeatMs: 1000,
            ttlMs: 3000,
        });
        a.setKey({ createdAt: 1, seq: 1 });
        b.setKey({ createdAt: 1, seq: 2 });
        a.submitLocal(loaded("/a.wav"));
        b.submitLocal(loaded("/b.wav"));
        // A is reporter at this point
        expect(appA.updateModelContext).toHaveBeenCalled();
        expect(appB.updateModelContext).not.toHaveBeenCalled();
        appB.updateModelContext.mockClear();
        // Advance fake clock past ttl without firing A's ticks.
        vi.advanceTimersByTime(4000);
        // Fire B's tick (heartbeat) → prune A from roster → B becomes reporter
        bTimers[0]?.();
        // Throttled publish trailing — advance enough
        vi.advanceTimersByTime(200);
        expect(appB.updateModelContext).toHaveBeenCalled();
        const text = lastText(appB);
        expect(text).not.toContain("/a.wav");
        expect(text).toContain("/b.wav");
        a.destroy();
        b.destroy();
    });

    it("late arrival with higher key: A's next publish includes C; once C learns of A it stops", () => {
        const { makeChannel } = makeFakeRegistry();
        // Use seamed setInterval so we can fire heartbeats deterministically.
        const aTimers: Array<() => void> = [];
        const cTimers: Array<() => void> = [];
        const appA = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
            setInterval: (fn) => {
                aTimers.push(fn);
                return 1;
            },
            clearInterval: () => {},
        });
        a.setKey({ createdAt: 1, seq: 1 });
        a.submitLocal(loaded("/a.wav"));
        expect(appA.updateModelContext).toHaveBeenCalled();
        appA.updateModelContext.mockClear();
        const appC = makeApp();
        const c = createInstanceCoordinator(appC, {
            channelFactory: makeChannel,
            randomInstanceId: () => "c",
            setInterval: (fn) => {
                cTimers.push(fn);
                return 2;
            },
            clearInterval: () => {},
        });
        c.setKey({ createdAt: 2, seq: 1 });
        c.submitLocal(loaded("/c.wav"));
        // C does not yet know about A → publishes its own single doc.
        // A learns about C from C's broadcast and schedules trailing publish.
        vi.advanceTimersByTime(200);
        // A's combined publish reflects both files.
        const aText = lastText(appA);
        expect(aText).toContain("/a.wav");
        expect(aText).toContain("/c.wav");
        // Now simulate A's heartbeat so C learns about A.
        vi.advanceTimersByTime(1000);
        aTimers[0]?.();
        vi.advanceTimersByTime(200);
        // After convergence, another C update should not cause C to publish.
        appA.updateModelContext.mockClear();
        appC.updateModelContext.mockClear();
        c.submitLocal(loaded("/c2.wav"));
        vi.advanceTimersByTime(200);
        expect(appC.updateModelContext).not.toHaveBeenCalled();
        expect(appA.updateModelContext).toHaveBeenCalled();
        a.destroy();
        c.destroy();
    });

    it("late arrival with smaller key takes over reporting", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        a.setKey({ createdAt: 10, seq: 1 });
        a.submitLocal(loaded("/a.wav"));
        appA.updateModelContext.mockClear();
        const appC = makeApp();
        const c = createInstanceCoordinator(appC, {
            channelFactory: makeChannel,
            randomInstanceId: () => "c",
        });
        c.setKey({ createdAt: 5, seq: 1 });
        c.submitLocal(loaded("/c.wav"));
        vi.advanceTimersByTime(200);
        // C is the new reporter
        expect(appC.updateModelContext).toHaveBeenCalled();
        // A should stop publishing on its next coalesced send
        appA.updateModelContext.mockClear();
        vi.advanceTimersByTime(200);
        expect(appA.updateModelContext).not.toHaveBeenCalled();
        a.destroy();
        c.destroy();
    });

    it("goodbye triggers re-election and re-publish", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const appB = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        const b = createInstanceCoordinator(appB, {
            channelFactory: makeChannel,
            randomInstanceId: () => "b",
        });
        a.setKey({ createdAt: 1, seq: 1 });
        b.setKey({ createdAt: 1, seq: 2 });
        a.submitLocal(loaded("/a.wav"));
        b.submitLocal(loaded("/b.wav"));
        appB.updateModelContext.mockClear();
        a.destroy();
        vi.advanceTimersByTime(200);
        expect(appB.updateModelContext).toHaveBeenCalled();
        const text = lastText(appB);
        expect(text).not.toContain("/a.wav");
        expect(text).toContain("/b.wav");
        b.destroy();
    });

    it("submitLocal before setKey records state but does not broadcast or publish", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const appB = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        // B exists just to be the receiver
        const b = createInstanceCoordinator(appB, {
            channelFactory: makeChannel,
            randomInstanceId: () => "b",
        });
        b.setKey({ createdAt: 100, seq: 1 }); // larger key so A will be reporter once it sets
        a.submitLocal(loaded("/a.wav"));
        // No broadcast yet (no key)
        expect(appA.updateModelContext).not.toHaveBeenCalled();
        // B never saw A's state
        b.submitLocal(loaded("/b.wav"));
        // B is alone-as-far-as-it-knows, so B publishes.
        expect(appB.updateModelContext).toHaveBeenCalled();
        const before = appB.updateModelContext.mock.calls.length;
        // Now A sets key — should broadcast and start participating
        appB.updateModelContext.mockClear();
        a.setKey({ createdAt: 1, seq: 1 });
        // A's broadcast triggers B to re-publish (combined). And A also publishes.
        vi.advanceTimersByTime(200);
        expect(appA.updateModelContext).toHaveBeenCalled();
        const text = lastText(appA);
        expect(text).toContain("/a.wav");
        expect(text).toContain("/b.wav");
        // B got informed it is no longer reporter and stops on next coalesce.
        expect(appB.updateModelContext.mock.calls.length).toBeLessThanOrEqual(
            before + 1,
        );
        a.destroy();
        b.destroy();
    });

    it("pre-key remote message populates roster; we participate after setKey", () => {
        const { makeChannel } = makeFakeRegistry();
        const appA = makeApp();
        const appB = makeApp();
        const a = createInstanceCoordinator(appA, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
        });
        const b = createInstanceCoordinator(appB, {
            channelFactory: makeChannel,
            randomInstanceId: () => "b",
        });
        // B sets key and broadcasts first
        b.setKey({ createdAt: 2, seq: 1 });
        b.submitLocal(loaded("/b.wav"));
        // A's roster should now have B (received pre-key). A still silent.
        expect(appA.updateModelContext).not.toHaveBeenCalled();
        // A sets key and submits. Combined doc should list both, A as reporter.
        a.setKey({ createdAt: 1, seq: 1 });
        a.submitLocal(loaded("/a.wav"));
        expect(appA.updateModelContext).toHaveBeenCalled();
        const text = lastText(appA);
        expect(text).toContain("/a.wav");
        expect(text).toContain("/b.wav");
        a.destroy();
        b.destroy();
    });

    it("updateModelContext rejection routes to logError and coordinator keeps working", async () => {
        const { makeChannel } = makeFakeRegistry();
        const app = {
            updateModelContext: vi
                .fn()
                .mockRejectedValueOnce(new Error("nope"))
                .mockResolvedValue({}),
        };
        const logError = vi.fn();
        const c = createInstanceCoordinator(app, {
            channelFactory: makeChannel,
            randomInstanceId: () => "a",
            logError,
        });
        c.setKey({ createdAt: 1, seq: 1 });
        c.submitLocal(loaded("/a.wav"));
        await Promise.resolve();
        await Promise.resolve();
        expect(logError).toHaveBeenCalledTimes(1);
        c.submitLocal(loaded("/a2.wav"));
        expect(app.updateModelContext).toHaveBeenCalledTimes(2);
        c.destroy();
    });
});
