import "./app.css";
import { App } from "@modelcontextprotocol/ext-apps";
import { sniffAudioMime } from "./audio-mime";
import { base64ToBlob } from "./base64-blob";
import { createPlayer, type Player } from "./player";

const fileInfoEl = document.querySelector("#file-info") as HTMLElement;
const playPauseBtn = document.querySelector("#play-pause") as HTMLButtonElement;

const app = new App({ name: "Audio File App", version: "1.0.0" });
app.connect();

type AudioState = { path: string; blob: Blob; url: string; player: Player };

let currentAudio: AudioState | null = null;
let loadGen = 0;

app.ontoolresult = async (result) => {
    const filePath = result.content?.find(c => c.type === "text")?.text;
    if (!filePath) return;

    const myGen = ++loadGen;
    releaseCurrent();

    const blob = await loadAudioBlob(filePath, () => myGen === loadGen);
    if (myGen !== loadGen || blob === null) return;

    const url = URL.createObjectURL(blob);
    const player = createPlayer(url, playPauseBtn);
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

async function loadAudioBlob(
    filePath: string,
    stillCurrent: () => boolean,
): Promise<Blob | null> {
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

    const mime = sniffAudioMime(base64);
    const strt = performance.now();
    const blob = await base64ToBlob(base64, mime, stillCurrent);
    console.log(`Decoded base64 to blob in ${(performance.now() - strt).toFixed(2)} ms`);
    base64 = null;
    return blob;
}
