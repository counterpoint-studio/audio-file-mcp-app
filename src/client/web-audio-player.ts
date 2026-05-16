import {
    Input,
    ALL_FORMATS,
    BlobSource,
    AudioBufferSink,
    InputDisposedError,
    UnsupportedInputFormatError,
    type InputAudioTrack,
    type WrappedAudioBuffer,
} from "mediabunny";

const HAVE_NOTHING = 0;
const HAVE_METADATA = 1;

const LOOK_AHEAD_SEC = 1.0;
const START_LEAD_SEC = 0.05;
const TIMEUPDATE_MIN_INTERVAL_SEC = 0.05;
const BACKPRESSURE_WAIT_MS = 50;

export type WebAudioPlayerErrorKind = "unsupported" | "decode-failed";

export class WebAudioPlayerError {
    readonly code: number;
    readonly message: string;
    readonly kind: WebAudioPlayerErrorKind;
    constructor(kind: WebAudioPlayerErrorKind, message: string) {
        this.kind = kind;
        this.message = message;
        this.code = kind === "unsupported" ? 4 : 3;
    }
}

type SinkLike = {
    buffers(start?: number, end?: number): AsyncGenerator<WrappedAudioBuffer, void, unknown>;
};

type InputLike = {
    getPrimaryAudioTrack(): Promise<InputAudioTrack | null>;
    computeDuration(): Promise<number>;
    dispose(): void;
};

export type WebAudioPlayerDeps = {
    createContext?: () => AudioContext;
    createInput?: (blob: Blob) => InputLike;
    createSink?: (track: InputAudioTrack) => SinkLike;
};

export type WebAudioPlayer = EventTarget & {
    currentTime: number;
    readonly duration: number;
    readonly paused: boolean;
    loop: boolean;
    readonly readyState: number;
    readonly error: WebAudioPlayerError | null;
    play(): Promise<void>;
    pause(): void;
    destroy(): void;
    setLoopRegion(startSec: number, endSec: number): void;
    clearLoopRegion(): void;
};

type LoopRange = { start: number; end: number };

export function createWebAudioPlayer(
    blob: Blob,
    deps: WebAudioPlayerDeps = {},
): WebAudioPlayer {
    const ctxFactory =
        deps.createContext ?? (() => new AudioContext());
    const inputFactory =
        deps.createInput ??
        ((b: Blob) =>
            new Input({ formats: ALL_FORMATS, source: new BlobSource(b) }));
    const sinkFactory =
        deps.createSink ?? ((t: InputAudioTrack) => new AudioBufferSink(t));

    const target = new EventTarget() as WebAudioPlayer;

    let audioContext: AudioContext | null = null;
    let gainNode: GainNode | null = null;

    let input: InputLike | null = null;
    let sink: SinkLike | null = null;

    let duration = 0;
    let readyState = HAVE_NOTHING;
    let error: WebAudioPlayerError | null = null;

    let playing = false;
    let loop = false;
    let loopRegion: LoopRange | null = null;
    let playbackTimeAtStart = 0;
    let audioContextStartTime = 0;
    let nextScheduleTime = 0;

    let iterator: AsyncIterator<WrappedAudioBuffer, void> | null = null;
    let pumpRunId = 0;
    let scheduledNodes: AudioBufferSourceNode[] = [];
    let endTimerId: ReturnType<typeof setTimeout> | null = null;
    let timeUpdateRaf = 0;
    let destroyed = false;
    let metadataReady: Promise<void>;
    let resolveMetadataReady: (() => void) | null = null;

    metadataReady = new Promise<void>((resolve) => {
        resolveMetadataReady = resolve;
    });

    function fire(type: string): void {
        target.dispatchEvent(new Event(type));
    }

    function ensureContext(): AudioContext {
        if (!audioContext) {
            audioContext = ctxFactory();
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
        }
        return audioContext;
    }

    function clamp(v: number, lo: number, hi: number): number {
        if (!Number.isFinite(v)) return lo;
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }

    function activeLoopRange(): LoopRange | null {
        if (loopRegion) return loopRegion;
        if (loop && duration > 0) return { start: 0, end: duration };
        return null;
    }

    function getCurrentTime(): number {
        if (!playing || !audioContext) {
            if (duration > 0) return clamp(playbackTimeAtStart, 0, duration);
            return playbackTimeAtStart < 0 ? 0 : playbackTimeAtStart;
        }
        let t =
            audioContext.currentTime - audioContextStartTime + playbackTimeAtStart;
        const range = activeLoopRange();
        if (range) {
            const len = range.end - range.start;
            if (len > 0) {
                t = ((t - range.start) % len + len) % len + range.start;
            }
        }
        if (duration > 0 && t > duration) t = duration;
        if (t < 0) t = 0;
        return t;
    }

    function makeIterator(startSec: number): AsyncIterator<
        WrappedAudioBuffer,
        void
    > {
        if (!sink) throw new Error("sink not ready");
        if (loopRegion) {
            return sink
                .buffers(startSec, loopRegion.end)
                [Symbol.asyncIterator]();
        }
        return sink.buffers(startSec)[Symbol.asyncIterator]();
    }

    function tearDownScheduledNodes(): void {
        if (endTimerId !== null) {
            clearTimeout(endTimerId);
            endTimerId = null;
        }
        for (const n of scheduledNodes) {
            try {
                n.stop();
            } catch {
                // ignore: node may not have started yet
            }
            try {
                n.disconnect();
            } catch {
                // ignore
            }
        }
        scheduledNodes = [];
        const it = iterator;
        iterator = null;
        if (it && it.return) {
            void it.return(undefined).catch(() => undefined);
        }
        pumpRunId++;
    }

    function tearDownPlayback(): void {
        if (timeUpdateRaf !== 0) {
            cancelAnimationFrame(timeUpdateRaf);
            timeUpdateRaf = 0;
        }
        tearDownScheduledNodes();
    }

    function setError(kind: WebAudioPlayerErrorKind, message: string): void {
        if (error) return;
        error = new WebAudioPlayerError(kind, message);
        if (resolveMetadataReady) {
            resolveMetadataReady();
            resolveMetadataReady = null;
        }
        fire("error");
    }

    async function load(): Promise<void> {
        try {
            input = inputFactory(blob);
            const track = await input.getPrimaryAudioTrack();
            if (destroyed) return;
            if (!track) {
                setError("unsupported", "no audio track");
                return;
            }
            const d = await input.computeDuration();
            if (destroyed) return;
            duration = Number.isFinite(d) && d > 0 ? d : 0;
            sink = sinkFactory(track);
            readyState = HAVE_METADATA;
            if (resolveMetadataReady) {
                resolveMetadataReady();
                resolveMetadataReady = null;
            }
            fire("loadedmetadata");
        } catch (err) {
            if (destroyed) return;
            if (err instanceof InputDisposedError) return;
            const msg = err instanceof Error ? err.message : String(err);
            const kind: WebAudioPlayerErrorKind =
                err instanceof UnsupportedInputFormatError
                    ? "unsupported"
                    : "decode-failed";
            setError(kind, msg);
        }
    }

    function wait(ms: number): Promise<void> {
        return new Promise((r) => setTimeout(r, ms));
    }

    function truncateBufferToDuration(
        ctx: AudioContext,
        orig: AudioBuffer,
        durSec: number,
    ): AudioBuffer {
        const sr = orig.sampleRate;
        const newLen = Math.max(1, Math.floor(durSec * sr));
        const out = ctx.createBuffer(orig.numberOfChannels, newLen, sr);
        for (let c = 0; c < orig.numberOfChannels; c++) {
            const src = orig.getChannelData(c);
            const dst = out.getChannelData(c);
            dst.set(src.subarray(0, newLen));
        }
        return out;
    }

    async function runPump(runId: number): Promise<void> {
        if (!iterator || !audioContext || !sink || !gainNode) return;
        const ctx = audioContext;
        const g = gainNode;
        try {
            while (true) {
                if (runId !== pumpRunId || destroyed) return;
                const result = await iterator.next();
                if (runId !== pumpRunId || destroyed) return;

                if (result.done) {
                    if (loopRegion) {
                        // Seamless region wrap. nextScheduleTime is the seam
                        // (end of last scheduled buffer at regionEnd).
                        audioContextStartTime = nextScheduleTime;
                        playbackTimeAtStart = loopRegion.start;
                        iterator = makeIterator(loopRegion.start);
                        continue;
                    }
                    if (loop && duration > 0) {
                        audioContextStartTime = nextScheduleTime;
                        playbackTimeAtStart = 0;
                        iterator = makeIterator(0);
                        continue;
                    }
                    scheduleEndedAt(nextScheduleTime, runId);
                    return;
                }

                let { buffer } = result.value;
                const { timestamp } = result.value;
                // Truncate boundary buffer when region looping.
                if (loopRegion) {
                    const remaining = loopRegion.end - timestamp;
                    if (remaining <= 0) {
                        // already at or past regionEnd; treat as done
                        audioContextStartTime = nextScheduleTime;
                        playbackTimeAtStart = loopRegion.start;
                        iterator = makeIterator(loopRegion.start);
                        continue;
                    }
                    if (remaining < buffer.duration - 1 / buffer.sampleRate) {
                        buffer = truncateBufferToDuration(ctx, buffer, remaining);
                    }
                }
                const node = ctx.createBufferSource();
                node.buffer = buffer;
                node.connect(g);
                const startAt =
                    audioContextStartTime + timestamp - playbackTimeAtStart;
                if (startAt >= ctx.currentTime) {
                    node.start(startAt);
                } else {
                    node.start(ctx.currentTime, ctx.currentTime - startAt);
                }
                scheduledNodes.push(node);
                const tail = startAt + buffer.duration;
                if (tail > nextScheduleTime) nextScheduleTime = tail;

                while (
                    playing &&
                    runId === pumpRunId &&
                    !destroyed &&
                    nextScheduleTime - ctx.currentTime > LOOK_AHEAD_SEC
                ) {
                    await wait(BACKPRESSURE_WAIT_MS);
                }
            }
        } catch (err) {
            if (destroyed || runId !== pumpRunId) return;
            if (err instanceof InputDisposedError) return;
            const msg = err instanceof Error ? err.message : String(err);
            setError("decode-failed", msg);
        }
    }

    function scheduleEndedAt(t: number, runId: number): void {
        if (!audioContext) return;
        const remainingMs = Math.max(
            0,
            (t - audioContext.currentTime) * 1000,
        );
        endTimerId = setTimeout(() => {
            if (runId !== pumpRunId || destroyed) return;
            playing = false;
            playbackTimeAtStart = duration;
            tearDownPlayback();
            fire("timeupdate");
            fire("ended");
            fire("pause");
        }, remainingMs);
    }

    function startTimeUpdateLoop(): void {
        let lastEmitted = -1;
        const tick = () => {
            if (!playing || destroyed) return;
            const now = getCurrentTime();
            if (lastEmitted < 0 || Math.abs(now - lastEmitted) >= TIMEUPDATE_MIN_INTERVAL_SEC) {
                lastEmitted = now;
                fire("timeupdate");
            }
            timeUpdateRaf = requestAnimationFrame(tick);
        };
        timeUpdateRaf = requestAnimationFrame(tick);
    }

    function startScheduling(fromSec: number): void {
        if (!audioContext || !sink) return;
        const ctx = audioContext;
        audioContextStartTime = ctx.currentTime + START_LEAD_SEC;
        nextScheduleTime = audioContextStartTime;
        playbackTimeAtStart = fromSec;
        iterator = makeIterator(fromSec);
        const runId = ++pumpRunId;
        void runPump(runId);
    }

    async function play(): Promise<void> {
        if (destroyed) return;
        if (error) return;
        if (playing) return;
        if (readyState < HAVE_METADATA) {
            await metadataReady;
            if (destroyed || error) return;
        }
        if (!sink) return;
        const ctx = ensureContext();
        if (ctx.state === "suspended") {
            try {
                await ctx.resume();
            } catch {
                // ignore — playback will simply not advance
            }
        }
        if (destroyed) return;
        playing = true;
        const cappedStart = duration > 0
            ? clamp(playbackTimeAtStart, 0, duration)
            : playbackTimeAtStart;
        const fromSec = loopRegion
            ? (cappedStart < loopRegion.start || cappedStart >= loopRegion.end
                  ? loopRegion.start
                  : cappedStart)
            : cappedStart;
        startScheduling(fromSec);
        fire("play");
        startTimeUpdateLoop();
    }

    function pause(): void {
        if (!playing) return;
        const now = getCurrentTime();
        tearDownPlayback();
        playing = false;
        playbackTimeAtStart = now;
        fire("timeupdate");
        fire("pause");
    }

    function seek(sec: number): void {
        const targetSec = duration > 0 ? clamp(sec, 0, duration) : Math.max(0, sec);
        const wasPlaying = playing;
        if (playing) {
            tearDownPlayback();
            playing = false;
        }
        playbackTimeAtStart = targetSec;
        fire("seeked");
        fire("timeupdate");
        if (wasPlaying) {
            void play();
        }
    }

    function rebuildLoopState(): void {
        if (!playing) return;
        if (timeUpdateRaf !== 0) {
            cancelAnimationFrame(timeUpdateRaf);
            timeUpdateRaf = 0;
        }
        // Capture current playhead BEFORE invalidating bookkeeping.
        const now = getCurrentTime();
        tearDownScheduledNodes();
        const fromSec = loopRegion
            ? (now < loopRegion.start || now >= loopRegion.end
                  ? loopRegion.start
                  : now)
            : now;
        startScheduling(fromSec);
        startTimeUpdateLoop();
    }

    function setLoopRegion(startSec: number, endSec: number): void {
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return;
        const lo = Math.max(0, Math.min(startSec, endSec));
        const hi = Math.max(startSec, endSec);
        const cappedHi = duration > 0 ? Math.min(duration, hi) : hi;
        if (!(cappedHi > lo)) {
            clearLoopRegion();
            return;
        }
        loopRegion = { start: lo, end: cappedHi };
        rebuildLoopState();
    }

    function clearLoopRegion(): void {
        if (!loopRegion) return;
        loopRegion = null;
        rebuildLoopState();
    }

    Object.defineProperties(target, {
        currentTime: {
            configurable: true,
            get: () => getCurrentTime(),
            set: (v: number) => seek(v),
        },
        duration: { configurable: true, get: () => duration },
        paused: { configurable: true, get: () => !playing },
        loop: {
            configurable: true,
            get: () => loop,
            set: (v: boolean) => {
                loop = !!v;
            },
        },
        readyState: { configurable: true, get: () => readyState },
        error: { configurable: true, get: () => error },
        play: { configurable: true, value: play },
        pause: { configurable: true, value: pause },
        setLoopRegion: { configurable: true, value: setLoopRegion },
        clearLoopRegion: { configurable: true, value: clearLoopRegion },
        destroy: {
            configurable: true,
            value: () => {
                if (destroyed) return;
                destroyed = true;
                tearDownPlayback();
                playing = false;
                if (resolveMetadataReady) {
                    resolveMetadataReady();
                    resolveMetadataReady = null;
                }
                if (audioContext) {
                    try {
                        void audioContext.close();
                    } catch {
                        // ignore
                    }
                    audioContext = null;
                    gainNode = null;
                }
                if (input) {
                    try {
                        input.dispose();
                    } catch {
                        // ignore
                    }
                    input = null;
                }
            },
        },
    });

    void load();

    return target;
}
