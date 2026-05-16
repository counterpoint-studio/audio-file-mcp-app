import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    createWebAudioPlayer,
    type WebAudioPlayer,
} from "./web-audio-player";
import type { InputAudioTrack, WrappedAudioBuffer } from "mediabunny";

type FakeNode = {
    started: number | null;
    offset: number;
    stopped: boolean;
    disconnected: boolean;
    buffer: { duration: number; sampleRate: number; numberOfChannels: number } | null;
};

class FakeContext {
    currentTime = 0;
    state: AudioContextState = "running";
    destination = {} as AudioDestinationNode;
    nodes: FakeNode[] = [];
    createGain(): GainNode {
        return { connect: () => undefined, disconnect: () => undefined } as unknown as GainNode;
    }
    createBuffer(numCh: number, length: number, sampleRate: number): AudioBuffer {
        const channels: Float32Array[] = [];
        for (let c = 0; c < numCh; c++) channels.push(new Float32Array(length));
        return {
            numberOfChannels: numCh,
            length,
            sampleRate,
            duration: length / sampleRate,
            getChannelData: (c: number) => channels[c],
        } as unknown as AudioBuffer;
    }
    createBufferSource(): AudioBufferSourceNode {
        const node: FakeNode = {
            started: null,
            offset: 0,
            stopped: false,
            disconnected: false,
            buffer: null,
        };
        this.nodes.push(node);
        const handle = {
            set buffer(b: AudioBuffer | null) {
                node.buffer = b as unknown as FakeNode["buffer"];
            },
            connect: () => undefined,
            disconnect: () => {
                node.disconnected = true;
            },
            start: (when?: number, offset?: number) => {
                node.started = when ?? 0;
                node.offset = offset ?? 0;
            },
            stop: () => {
                node.stopped = true;
            },
        };
        return handle as unknown as AudioBufferSourceNode;
    }
    async resume(): Promise<void> {
        this.state = "running";
    }
    async close(): Promise<void> {
        this.state = "closed";
    }
}

function makeBuffer(durationSec: number): AudioBuffer {
    const sr = 48000;
    const len = Math.round(durationSec * sr);
    const channels = [new Float32Array(len), new Float32Array(len)];
    return {
        duration: durationSec,
        sampleRate: sr,
        numberOfChannels: 2,
        length: len,
        getChannelData: (c: number) => channels[c],
    } as unknown as AudioBuffer;
}

function fakeTrack(): InputAudioTrack {
    return {} as unknown as InputAudioTrack;
}

type FakeInput = {
    getPrimaryAudioTrack: () => Promise<InputAudioTrack | null>;
    computeDuration: () => Promise<number>;
    dispose: () => void;
};

type SinkPlan = {
    chunkSec: number;
    totalSec: number;
};

function makeFakeSink(plan: SinkPlan) {
    return {
        buffers(
            startTimestamp?: number,
            endTimestamp?: number,
        ): AsyncGenerator<WrappedAudioBuffer, void, unknown> {
            const start = startTimestamp ?? 0;
            const cap =
                endTimestamp !== undefined
                    ? Math.min(endTimestamp, plan.totalSec)
                    : plan.totalSec;
            const list: WrappedAudioBuffer[] = [];
            // Round start down to the nearest chunk grid so we get the buffer
            // containing the requested timestamp (mimics mediabunny semantics).
            const chunkIdxStart = Math.floor(start / plan.chunkSec);
            for (
                let t = chunkIdxStart * plan.chunkSec;
                t < cap - 1e-9;
                t += plan.chunkSec
            ) {
                const dur = Math.min(plan.chunkSec, plan.totalSec - t);
                list.push({
                    buffer: makeBuffer(dur),
                    timestamp: t,
                    duration: dur,
                });
            }
            let i = 0;
            const gen: AsyncGenerator<WrappedAudioBuffer, void, unknown> = {
                [Symbol.asyncIterator]() {
                    return this;
                },
                next: async () => {
                    if (i < list.length) {
                        return { value: list[i++], done: false };
                    }
                    return { value: undefined as unknown as WrappedAudioBuffer, done: true };
                },
                return: async () => ({ value: undefined, done: true }),
                throw: async () => ({ value: undefined, done: true }),
            };
            return gen;
        },
    };
}

let originalRaf: typeof requestAnimationFrame | undefined;
let originalCaf: typeof cancelAnimationFrame | undefined;
let originalAudioContext: typeof AudioContext | undefined;

beforeEach(() => {
    originalRaf = globalThis.requestAnimationFrame;
    originalCaf = globalThis.cancelAnimationFrame;
    originalAudioContext = (globalThis as { AudioContext?: typeof AudioContext })
        .AudioContext;
    let nextId = 1;
    (globalThis as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
        (() => nextId++) as typeof requestAnimationFrame;
    (globalThis as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
        (() => undefined) as typeof cancelAnimationFrame;
});

afterEach(() => {
    if (originalRaf) globalThis.requestAnimationFrame = originalRaf;
    if (originalCaf) globalThis.cancelAnimationFrame = originalCaf;
    if (originalAudioContext) {
        (globalThis as { AudioContext?: typeof AudioContext }).AudioContext =
            originalAudioContext;
    } else {
        delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    }
});

function awaitMetadata(player: WebAudioPlayer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
            player.removeEventListener("loadedmetadata", onLoaded);
            player.removeEventListener("error", onError);
            resolve();
        };
        const onError = () => {
            player.removeEventListener("loadedmetadata", onLoaded);
            player.removeEventListener("error", onError);
            reject(new Error("error event fired"));
        };
        player.addEventListener("loadedmetadata", onLoaded);
        player.addEventListener("error", onError);
    });
}

function setupPlayer(opts: {
    durationSec: number;
    chunkSec?: number;
    track?: InputAudioTrack | null;
    ctx?: FakeContext;
}): { player: WebAudioPlayer; ctx: FakeContext; input: FakeInput } {
    const chunkSec = opts.chunkSec ?? 0.5;
    const ctx = opts.ctx ?? new FakeContext();
    const dispose = vi.fn();
    const input: FakeInput = {
        getPrimaryAudioTrack: async () => opts.track === undefined ? fakeTrack() : opts.track,
        computeDuration: async () => opts.durationSec,
        dispose,
    };
    const sink = makeFakeSink({ chunkSec, totalSec: opts.durationSec });
    const player = createWebAudioPlayer(new Blob([new Uint8Array([1])]), {
        createContext: () => ctx as unknown as AudioContext,
        createInput: () => input,
        createSink: () => sink,
    });
    return { player, ctx, input };
}

describe("WebAudioPlayer", () => {
    it("emits loadedmetadata with duration and readyState>=1", async () => {
        const { player } = setupPlayer({ durationSec: 10 });
        await awaitMetadata(player);
        expect(player.duration).toBe(10);
        expect(player.readyState).toBeGreaterThanOrEqual(1);
        expect(player.paused).toBe(true);
        expect(player.currentTime).toBe(0);
    });

    it("emits error when no audio track present", async () => {
        const { player } = setupPlayer({ durationSec: 0, track: null });
        const onError = vi.fn();
        player.addEventListener("error", onError);
        await new Promise<void>((resolve) => {
            player.addEventListener("error", () => resolve(), { once: true });
        });
        expect(onError).toHaveBeenCalled();
        expect(player.error?.kind).toBe("unsupported");
    });

    it("currentTime tracks AudioContext clock during playback", async () => {
        const { player, ctx } = setupPlayer({ durationSec: 10 });
        await awaitMetadata(player);
        await player.play();
        // After play(), audioContextStartTime = ctx.currentTime + 0.05 lead.
        expect(player.paused).toBe(false);
        ctx.currentTime = 0.05; // exactly start point
        expect(player.currentTime).toBeCloseTo(0, 5);
        ctx.currentTime = 1.05;
        expect(player.currentTime).toBeCloseTo(1, 5);
        player.pause();
        expect(player.paused).toBe(true);
        expect(player.currentTime).toBeCloseTo(1, 5);
    });

    it("seek while paused updates playhead and fires seeked", async () => {
        const { player } = setupPlayer({ durationSec: 10 });
        await awaitMetadata(player);
        const onSeeked = vi.fn();
        player.addEventListener("seeked", onSeeked);
        player.currentTime = 3.5;
        expect(onSeeked).toHaveBeenCalled();
        expect(player.currentTime).toBe(3.5);
    });

    it("seek while playing resumes from the new position", async () => {
        const { player, ctx } = setupPlayer({ durationSec: 10 });
        await awaitMetadata(player);
        await player.play();
        ctx.currentTime = 1;
        player.currentTime = 5;
        // brief microtask drain so play() can re-run
        await Promise.resolve();
        await Promise.resolve();
        expect(player.paused).toBe(false);
        // After resume, playbackTimeAtStart should be 5
        ctx.currentTime = ctx.currentTime + 0.05;
        expect(player.currentTime).toBeCloseTo(5, 5);
    });

    it("schedules buffers at the expected AudioContext times", async () => {
        const ctx = new FakeContext();
        const { player } = setupPlayer({ durationSec: 1, chunkSec: 0.25, ctx });
        await awaitMetadata(player);
        await player.play();
        // Let pump run through all buffers (no real backpressure since ctx.currentTime=0)
        for (let i = 0; i < 20; i++) await Promise.resolve();
        // Expect at least the first 4 buffers scheduled
        expect(ctx.nodes.length).toBeGreaterThanOrEqual(4);
        // Lead-in is 0.05
        expect(ctx.nodes[0].started).toBeCloseTo(0.05, 5);
        expect(ctx.nodes[1].started).toBeCloseTo(0.30, 5);
        expect(ctx.nodes[2].started).toBeCloseTo(0.55, 5);
        expect(ctx.nodes[3].started).toBeCloseTo(0.80, 5);
        player.pause();
    });

    it("fires ended after the last buffer when loop is false", async () => {
        vi.useFakeTimers();
        try {
            const ctx = new FakeContext();
            const { player } = setupPlayer({
                durationSec: 0.5,
                chunkSec: 0.25,
                ctx,
            });
            await awaitMetadata(player);
            const onEnded = vi.fn();
            player.addEventListener("ended", onEnded);
            await player.play();
            // Drain microtasks repeatedly to let the pump run.
            for (let i = 0; i < 40; i++) await Promise.resolve();
            // nextScheduleTime should be 0.55 (lead + duration). Advance ctx and timers.
            ctx.currentTime = 0.6;
            await vi.advanceTimersByTimeAsync(1000);
            expect(onEnded).toHaveBeenCalled();
            expect(player.paused).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("seamlessly wraps to start when loop is true", async () => {
        const ctx = new FakeContext();
        const { player } = setupPlayer({
            durationSec: 0.5,
            chunkSec: 0.25,
            ctx,
        });
        await awaitMetadata(player);
        player.loop = true;
        await player.play();
        for (let i = 0; i < 80; i++) await Promise.resolve();
        // After wrap, we should see more than just one file's worth of scheduled
        // nodes; pump should have continued past EOS.
        expect(ctx.nodes.length).toBeGreaterThan(2);
        // The third (post-wrap first) node should start at the prior tail (0.55)
        // because audioContextStartTime is reset to nextScheduleTime.
        const tails = ctx.nodes.map((n) => (n.started ?? 0) + (n.buffer?.duration ?? 0));
        // Tails should be strictly non-decreasing (continuous schedule).
        for (let i = 1; i < ctx.nodes.length; i++) {
            expect(tails[i]).toBeGreaterThanOrEqual(tails[i - 1] - 1e-6);
        }
        player.pause();
    });

    it("setLoopRegion truncates the boundary buffer at regionEnd", async () => {
        const ctx = new FakeContext();
        const { player } = setupPlayer({
            durationSec: 5,
            chunkSec: 0.5,
            ctx,
        });
        await awaitMetadata(player);
        // regionEnd = 0.8 lands mid-buffer (chunk 0.5..1.0).
        player.setLoopRegion(0.0, 0.8);
        await player.play();
        for (let i = 0; i < 80; i++) await Promise.resolve();
        // First chunk (0..0.5): full 0.5s. Second chunk (0.5..1.0): truncated to
        // 0.3s. Then the iterator restarts from 0 again — full 0.5s chunk.
        expect(ctx.nodes.length).toBeGreaterThanOrEqual(3);
        expect(ctx.nodes[0].buffer?.duration).toBeCloseTo(0.5, 5);
        expect(ctx.nodes[1].buffer?.duration).toBeCloseTo(0.3, 5);
        // Third node is the first buffer of the next iteration: full 0.5s.
        expect(ctx.nodes[2].buffer?.duration).toBeCloseTo(0.5, 5);
        // Schedule is continuous across the seam.
        const tails = ctx.nodes.map(
            (n) => (n.started ?? 0) + (n.buffer?.duration ?? 0),
        );
        for (let i = 1; i < ctx.nodes.length; i++) {
            expect(tails[i]).toBeGreaterThanOrEqual(tails[i - 1] - 1e-6);
        }
        player.pause();
    });

    it("currentTime wraps within an active loop region", async () => {
        const ctx = new FakeContext();
        const { player } = setupPlayer({
            durationSec: 5,
            chunkSec: 0.5,
            ctx,
        });
        await awaitMetadata(player);
        player.setLoopRegion(1.0, 2.0);
        await player.play();
        // After play(), audioContextStartTime = 0.05 lead. Inside region:
        ctx.currentTime = 0.05; // logical t = regionStart = 1.0
        expect(player.currentTime).toBeCloseTo(1.0, 5);
        ctx.currentTime = 0.55; // 0.5s in → 1.5
        expect(player.currentTime).toBeCloseTo(1.5, 5);
        ctx.currentTime = 1.05; // exactly 1s in → wraps to regionStart
        expect(player.currentTime).toBeCloseTo(1.0, 5);
        ctx.currentTime = 1.55; // 1.5s in → 1.5 (mid second iteration)
        expect(player.currentTime).toBeCloseTo(1.5, 5);
        player.pause();
    });

    it("clearLoopRegion releases the loop and continues from current playhead", async () => {
        const ctx = new FakeContext();
        const { player } = setupPlayer({
            durationSec: 5,
            chunkSec: 0.5,
            ctx,
        });
        await awaitMetadata(player);
        player.setLoopRegion(1.0, 2.0);
        await player.play();
        ctx.currentTime = 0.3; // logical t = 1.25
        player.clearLoopRegion();
        // After clearing while playing, scheduling rebuilt from current playhead.
        // currentTime should not jump.
        ctx.currentTime = 0.3 + 0.05; // lead-in
        expect(player.currentTime).toBeCloseTo(1.25, 4);
        player.pause();
    });

    it("destroy disposes input and closes the context", async () => {
        const ctx = new FakeContext();
        const { player, input } = setupPlayer({ durationSec: 5, ctx });
        await awaitMetadata(player);
        await player.play();
        player.destroy();
        expect(input.dispose).toHaveBeenCalled();
        expect(ctx.state).toBe("closed");
    });
});
