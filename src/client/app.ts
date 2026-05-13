import "./app.css";
import { App } from "@modelcontextprotocol/ext-apps";
import { wireTheme } from "./theme";
import {
    sniffAudioFormat,
    audioFormatToMime,
    audioFormatToDecodeFormat,
    type AudioDecodeFormat,
    type AudioFormat,
} from "./audio-formats";
import { base64ToBlob } from "./base64-blob";
import { createPlayer, type Player } from "./player";
import { extractMetadata } from "./metadata";
import { createMetadataDisplay, type MetadataDisplay } from "./metadata-display";
import {
    createAudioContextPublisher,
    type AudioContextPublisher,
} from "./audio-context-publisher";

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

type AudioState = {
    path: string;
    blob: Blob;
    url: string;
    player: Player;
    display: MetadataDisplay;
    publisher: AudioContextPublisher;
};
type LoadedAudio = {
    blob: Blob;
    format: AudioFormat | null;
    decodeFormat: AudioDecodeFormat | null;
};

let currentAudio: AudioState | null = null;
let loadGen = 0;

app.ontoolresult = async (result) => {
    const filePath = result.content?.find(c => c.type === "text")?.text;
    if (!filePath) return;

    const myGen = ++loadGen;
    releaseCurrent();
    hideError();
    playPauseBtn.classList.add("is-loading");

    try {
        let loaded: LoadedAudio | null;
        try {
            loaded = await loadAudio(filePath, () => myGen === loadGen);
        } catch (e) {
            if (myGen !== loadGen) return;
            const message = e instanceof Error ? e.message : String(e);
            showError("decode-failed", message);
            return;
        }
        if (myGen !== loadGen || loaded === null) return;

        const { blob, format, decodeFormat } = loaded;
        const metadata = await extractMetadata(format, blob);
        if (myGen !== loadGen) return;

        const durationSeconds = metadata?.duration ?? null;
        const durationExact = metadata?.durationExact ?? false;

        const url = URL.createObjectURL(blob);
        const publisher = createAudioContextPublisher(app);
        publisher.setFile(filePath);
        publisher.setMetadata(metadata);
        publisher.setDurationSeconds(durationSeconds);
        publisher.setPlayback("paused");
        publisher.setPosition(0, null);

        const player = createPlayer(
            url,
            blob,
            decodeFormat,
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
        currentAudio = { path: filePath, blob, url, player, display, publisher };
    } finally {
        if (myGen === loadGen) {
            playPauseBtn.classList.remove("is-loading");
        }
    }
};

function releaseCurrent(): void {
    if (currentAudio) {
        currentAudio.display.destroy();
        currentAudio.player.destroy();
        currentAudio.publisher.destroy();
        URL.revokeObjectURL(currentAudio.url);
        currentAudio = null;
    }
}

async function loadAudio(
    filePath: string,
    stillCurrent: () => boolean,
): Promise<LoadedAudio | null> {
    const uri = `audiofile://${encodeURIComponent(filePath)}`;
    let resourceResult: Awaited<ReturnType<typeof app.readServerResource>> | null =
        await app.readServerResource({ uri });
    if (!stillCurrent()) return null;

    const content = resourceResult.contents[0];
    if (!content || !("blob" in content)) {
        throw new Error("Expected blob content from resource response");
    }

    let base64: string | null = content.blob;
    resourceResult = null;

    const format = sniffAudioFormat(base64);
    const mime = audioFormatToMime(format);
    const decodeFormat = audioFormatToDecodeFormat(format);
    const strt = performance.now();
    const blob = await base64ToBlob(base64, mime, stillCurrent);
    console.log(`Decoded base64 to blob in ${(performance.now() - strt).toFixed(2)} ms`);
    base64 = null;
    if (blob === null) return null;
    return { blob, format, decodeFormat };
}
