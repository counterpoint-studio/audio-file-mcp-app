import { App } from "@modelcontextprotocol/ext-apps";

const fileInfoEl = document.querySelector("#file-info") as HTMLElement;

const app = new App({ name: "Audio File App", version: "1.0.0" });
app.connect();

type AudioState = { path: string; blob: Blob; url: string };

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
    currentAudio = { path: filePath, blob, url };
    fileInfoEl.textContent = `File: ${filePath}, size: ${blob.size} bytes`;
};

function releaseCurrent(): void {
    if (currentAudio) {
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

    const strt = performance.now();
    const blob = await base64ToBlob(base64, "application/octet-stream", stillCurrent);
    console.log(`Decoded base64 to blob in ${(performance.now() - strt).toFixed(2)} ms`);
    base64 = null;
    return blob;
}

const CHUNK_BASE64 = 1 << 20;       // 1 MiB; multiple of 4 → no padding split
const YIELD_EVERY_CHUNKS = 16;      // ~16 MiB of base64 between yields

async function base64ToBlob(
    base64: string,
    type: string,
    stillCurrent: () => boolean,
): Promise<Blob | null> {
    const parts: Blob[] = [];
    let chunkIdx = 0;
    for (let pos = 0; pos < base64.length; pos += CHUNK_BASE64) {
        if (!stillCurrent()) return null;
        const bytes = Uint8Array.fromBase64(base64.slice(pos, pos + CHUNK_BASE64));
        parts.push(new Blob([bytes]));
        if (++chunkIdx % YIELD_EVERY_CHUNKS === 0) {
            await new Promise<void>(r => setTimeout(r));
        }
    }
    return new Blob(parts, { type });
}
