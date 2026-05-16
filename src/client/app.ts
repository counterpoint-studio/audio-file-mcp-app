import "./app.css";
import { App } from "@modelcontextprotocol/ext-apps";
import { wireTheme } from "./theme";
import {
    sniffAudioFormatBytes,
    type AudioFormat,
} from "./audio-formats";
import { createPlayer, type Player } from "./player";
import { extractMetadata, METADATA_HEADER_BYTES } from "./metadata";
import { createMetadataDisplay, type MetadataDisplay } from "./metadata-display";
import {
    createAudioContextPublisher,
    type AudioContextPublisher,
} from "./audio-context-publisher";
import { createInstanceCoordinator } from "./instance-coordinator";
import {
    parseDisplayAudioInit,
    type DisplayAudioInit,
} from "./display-audio-init";
import { createChunkStore, type ChunkStore } from "./chunk-store";
import { createChunkBus, type ChunkBus } from "./chunk-bus";
import {
    createChunkLoader,
    type ChunkLoader,
} from "./chunk-loader";
import { createChunkedSource } from "./chunked-source";
import type { Source } from "mediabunny";

const metadataEl = document.querySelector("#info") as HTMLElement;
const playPauseBtn = document.querySelector("#play-pause") as HTMLButtonElement;
const seekBarEl = document.querySelector("#seek-bar") as HTMLElement;
const positionEl = document.querySelector("#position") as HTMLElement;
const durationEl = document.querySelector("#duration") as HTMLElement;
const spectrogramWrapEl = document.querySelector("#spectrogram-wrap") as HTMLElement;
const headerEl = document.querySelector("#top") as HTMLElement;
const statsEl = document.querySelector("#stats") as HTMLElement;
const errorBannerEl = document.querySelector("#error-banner") as HTMLElement;
const errorDetailEl = errorBannerEl.querySelector(".error-detail") as HTMLElement;

type DecodeErrorKind =
    | "unsupported"
    | "decode-failed"
    | "playback-unsupported";

function renderErrorDetail(kind: DecodeErrorKind, message?: string): string {
    const base =
        kind === "unsupported"
            ? "The file format is not supported."
            : kind === "playback-unsupported"
              ? "Playback of this file is not supported in this browser."
              : "The file could not be decoded.";
    const msg = message?.replace(/[\r\n\t]+/g, " ").trim();
    return msg ? `${base.slice(0, -1)} (${msg}).` : base;
}

function showError(kind: DecodeErrorKind, message?: string): void {
    headerEl.hidden = true;
    seekBarEl.hidden = true;
    statsEl.hidden = true;
    errorBannerEl.hidden = false;
    errorDetailEl.textContent = renderErrorDetail(kind, message);
}

function hideError(): void {
    headerEl.hidden = false;
    seekBarEl.hidden = false;
    statsEl.hidden = false;
    errorBannerEl.hidden = true;
    errorDetailEl.textContent = "";
}

const app = new App({ name: "Audio File App", version: "1.0.0" });
const connected = app.connect();
wireTheme(app, connected);
const coordinator = createInstanceCoordinator(app);
window.addEventListener("pagehide", () => coordinator.destroy(), { once: true });

let keyWarned = false;

type AudioState = {
    path: string;
    source: Source;
    store: ChunkStore;
    loader: ChunkLoader;
    chunkBus: ChunkBus;
    player: Player;
    display: MetadataDisplay;
    publisher: AudioContextPublisher;
};
type LoadedAudio = {
    source: Source;
    store: ChunkStore;
    loader: ChunkLoader;
    chunkBus: ChunkBus;
    format: AudioFormat | null;
};

let currentAudio: AudioState | null = null;
let loadGen = 0;

app.ontoolresult = async (result) => {
    const init = parseDisplayAudioInit(result);
    if (!init) return;
    const filePath = init.path;

    const sc = result.structuredContent as
        | { createdAt?: unknown; seq?: unknown }
        | undefined;
    if (
        sc &&
        typeof sc.createdAt === "number" &&
        typeof sc.seq === "number"
    ) {
        coordinator.setKey({ createdAt: sc.createdAt, seq: sc.seq });
    } else if (!keyWarned) {
        keyWarned = true;
        console.warn(
            "missing election key on toolresult — multi-instance coordination disabled",
        );
    }

    if (init.sizeBytes === undefined) {
        console.warn("display-audio-file result missing sizeBytes; cannot load");
        showError("decode-failed", "missing file size from server");
        return;
    }

    const myGen = ++loadGen;
    releaseCurrent();
    hideError();
    playPauseBtn.classList.add("is-loading");

    try {
        let loaded: LoadedAudio | null;
        try {
            loaded = await loadAudio(
                filePath,
                init.sizeBytes,
                () => myGen === loadGen,
            );
        } catch (e) {
            if (myGen !== loadGen) return;
            const message = e instanceof Error ? e.message : String(e);
            showError("decode-failed", message);
            return;
        }
        if (myGen !== loadGen || loaded === null) return;

        const { source, store, loader, chunkBus, format } = loaded;
        const headerLen = Math.min(METADATA_HEADER_BYTES, init.sizeBytes);
        await waitForRange(chunkBus, store, 0, headerLen, () => myGen === loadGen);
        if (myGen !== loadGen) {
            loader.cancel();
            return;
        }
        const headerBytes = await store.read(0, headerLen);
        const metadata = extractMetadata(format, headerBytes, init.sizeBytes);
        if (myGen !== loadGen) {
            loader.cancel();
            return;
        }

        const durationSeconds = metadata?.duration ?? null;
        const durationExact = metadata?.durationExact ?? false;

        const publisher = createAudioContextPublisher((s) =>
            coordinator.submitLocal(s),
        );
        publisher.setFile(filePath);
        publisher.setMetadata(metadata);
        publisher.setDurationSeconds(durationSeconds);
        publisher.setPlayback("paused");
        publisher.setPosition(0, null);

        const player = createPlayer(
            source,
            store,
            chunkBus,
            loader,
            format,
            playPauseBtn,
            seekBarEl,
            positionEl,
            durationEl,
            spectrogramWrapEl,
            durationSeconds,
            durationExact,
            {
                onPlayback: (playing) =>
                    publisher.setPlayback(playing ? "playing" : "paused"),
                onPosition: (seconds, samples) =>
                    publisher.setPosition(seconds, samples),
                onLiveMetrics: (m) =>
                    publisher.setGlobalMetrics({
                        samplePeak: m.samplePeak,
                        rms: m.rms,
                        truePeakDb: m.truePeak,
                        integratedLufs: m.integrated,
                    }),
                onDecoderInfo: (channels, sampleRate) =>
                    publisher.setDecoderInfo({ channels, sampleRate }),
                onRegionPreview: (a, b) => publisher.setRegionPreview(a, b),
                onRegion: (a, b) => publisher.setRegion(a, b),
                onRegionCleared: () => publisher.clearRegion(),
                onDecodeError: (kind, message) => {
                    if (myGen !== loadGen) return;
                    publisher.setError(kind, message);
                    showError(kind, message);
                },
            },
        );
        const display = createMetadataDisplay(metadataEl, player.worker);
        display.update(metadata, filePath);
        currentAudio = {
            path: filePath,
            source,
            store,
            loader,
            chunkBus,
            player,
            display,
            publisher,
        };
        applyInitialState(currentAudio, init, () => myGen === loadGen);
    } finally {
        if (myGen === loadGen) {
            playPauseBtn.classList.remove("is-loading");
        }
    }
};

function applyInitialState(
    state: AudioState,
    init: DisplayAudioInit,
    stillCurrent: () => boolean,
): void {
    if (init.playheadSeconds === undefined && !init.region) return;

    const apply = () => {
        if (!stillCurrent()) return;
        const { audio } = state.player;
        const duration = audio.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;

        if (init.region) {
            state.player.loopRegion.setRegion(
                init.region.startSeconds,
                init.region.endSeconds,
            );
        }

        const target =
            init.playheadSeconds ?? init.region?.startSeconds ?? 0;
        const clamped = Math.max(0, Math.min(duration, target));
        audio.currentTime = clamped;
        state.publisher.setPosition(clamped, null);
    };

    if (state.player.audio.readyState >= 1) {
        apply();
    } else {
        state.player.audio.addEventListener("loadedmetadata", apply, {
            once: true,
        });
    }
}

function releaseCurrent(): void {
    if (currentAudio) {
        currentAudio.loader.cancel();
        currentAudio.display.destroy();
        currentAudio.player.destroy();
        currentAudio.publisher.destroy();
        currentAudio = null;
    }
}

async function loadAudio(
    filePath: string,
    sizeBytes: number,
    stillCurrent: () => boolean,
): Promise<LoadedAudio | null> {
    const store = createChunkStore(sizeBytes);
    const chunkBus = createChunkBus();
    const loader = createChunkLoader(store, {
        path: filePath,
        totalSize: sizeBytes,
        chunkBytes: 1 << 20,
        concurrency: 4,
        fetcher: (start, length) =>
            mcpRangeFetcher(filePath, start, length),
        onChunk: (start, blob) => {
            store.add(start, blob);
            chunkBus.emit({ start, end: start + blob.size, blob });
        },
    });
    const source = createChunkedSource({
        store,
        loader,
        onChunk: chunkBus.subscribe,
    });

    await waitForFirstChunk(chunkBus, store, stillCurrent);
    if (!stillCurrent()) {
        loader.cancel();
        return null;
    }

    const head = await store.read(0, Math.min(64, sizeBytes));
    const format = sniffAudioFormatBytes(head);

    return { source, store, loader, chunkBus, format };
}

async function mcpRangeFetcher(
    path: string,
    start: number,
    length: number,
): Promise<Uint8Array> {
    const uri = `audiofile-range://${encodeURIComponent(path)}/${start}/${length}`;
    const result = await app.readServerResource({ uri });
    const content = result.contents[0];
    if (!content || !("blob" in content) || typeof content.blob !== "string") {
        throw new Error("expected blob content from range resource");
    }
    const bytes = Uint8Array.fromBase64(content.blob);
    return bytes;
}

function waitForFirstChunk(
    bus: ChunkBus,
    store: ChunkStore,
    stillCurrent: () => boolean,
): Promise<void> {
    return waitForRange(bus, store, 0, Math.min(1, store.totalSize), stillCurrent);
}

function waitForRange(
    bus: ChunkBus,
    store: ChunkStore,
    start: number,
    end: number,
    stillCurrent: () => boolean,
): Promise<void> {
    return new Promise<void>((resolve) => {
        if (end <= start || store.isLoaded(start, end)) {
            resolve();
            return;
        }
        const off = bus.subscribe(() => {
            if (!stillCurrent() || store.isLoaded(start, end)) {
                off();
                resolve();
            }
        });
    });
}

