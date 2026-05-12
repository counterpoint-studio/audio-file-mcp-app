import "./app.css";
import { App } from "@modelcontextprotocol/ext-apps";
import {
    sniffAudioFormat,
    audioFormatToMime,
    audioFormatToDecodeFormat,
    type AudioDecodeFormat,
} from "./audio-formats";
import { base64ToBlob } from "./base64-blob";
import { createPlayer, type Player } from "./player";

const fileInfoEl = document.querySelector("#file-info") as HTMLElement;
const playPauseBtn = document.querySelector("#play-pause") as HTMLButtonElement;
const seekBarEl = document.querySelector("#seek-bar") as HTMLElement;
const positionEl = document.querySelector("#position") as HTMLElement;
const durationEl = document.querySelector("#duration") as HTMLElement;
const spectrogramWrapEl = document.querySelector("#spectrogram-wrap") as HTMLElement;

const app = new App({ name: "Audio File App", version: "1.0.0" });
app.connect();

type AudioState = { path: string; blob: Blob; url: string; player: Player };
type LoadedAudio = { blob: Blob; decodeFormat: AudioDecodeFormat | null };

let currentAudio: AudioState | null = null;
let loadGen = 0;

app.ontoolresult = async (result) => {
    const filePath = result.content?.find(c => c.type === "text")?.text;
    if (!filePath) return;

    const myGen = ++loadGen;
    releaseCurrent();

    const loaded = await loadAudio(filePath, () => myGen === loadGen);
    if (myGen !== loadGen || loaded === null) return;

    const { blob, decodeFormat } = loaded;
    const url = URL.createObjectURL(blob);
    const player = createPlayer(
        url,
        blob,
        decodeFormat,
        playPauseBtn,
        seekBarEl,
        positionEl,
        durationEl,
        spectrogramWrapEl,
    );
    currentAudio = { path: filePath, blob, url, player };
    fileInfoEl.textContent = `File: ${filePath}, type: ${blob.type}, size: ${blob.size} bytes`;
};

function releaseCurrent(): void {
    if (currentAudio) {
        currentAudio.player.destroy();
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
    return { blob, decodeFormat };
}
