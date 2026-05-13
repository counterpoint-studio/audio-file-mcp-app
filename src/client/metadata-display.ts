import type { AudioMetadata } from "./metadata";
import { containerDisplayName } from "./metadata/container-name";
import { basename, formatSpec } from "./metadata-spec";

export type MetadataDisplay = {
    update(m: AudioMetadata | null, path: string): void;
    destroy(): void;
};

type Slots = {
    filename: HTMLElement;
    type: HTMLElement;
    size: HTMLElement;
    channels: HTMLElement;
    format: HTMLElement;
};

function requireSlot(rootEl: HTMLElement, id: string): HTMLElement {
    const el = rootEl.querySelector<HTMLElement>(`#${id}`);
    if (!el) throw new Error(`metadata-display: missing #${id}`);
    return el;
}

function readSlots(rootEl: HTMLElement): Slots {
    return {
        filename: requireSlot(rootEl, "md-filename"),
        type: requireSlot(rootEl, "md-type"),
        size: requireSlot(rootEl, "md-size"),
        channels: requireSlot(rootEl, "md-channels"),
        format: requireSlot(rootEl, "md-format"),
    };
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

export function createMetadataDisplay(
    rootEl: HTMLElement,
    audio: HTMLAudioElement,
    worker: Worker,
): MetadataDisplay {
    const slots = readSlots(rootEl);
    let current: AudioMetadata | null = null;
    let currentPath = "";
    let decoderChannels: number | undefined;
    let decoderSampleRate: number | undefined;

    function render(): void {
        if (currentPath) {
            slots.filename.textContent = basename(currentPath);
            slots.filename.title = currentPath;
        } else {
            slots.filename.textContent = "";
            slots.filename.title = "";
        }

        if (!current) {
            slots.type.textContent = "";
            slots.size.textContent = "";
            slots.channels.textContent = "";
            slots.format.textContent = "";
            return;
        }

        slots.type.textContent = containerDisplayName(current.container);
        slots.size.textContent = formatSize(current.sizeBytes);

        const effChannels = current.channels ?? decoderChannels;
        slots.channels.textContent = effChannels !== undefined ? `${effChannels}ch` : "";

        const duration =
            audio.duration && Number.isFinite(audio.duration) ? audio.duration : undefined;
        slots.format.textContent = formatSpec(current, decoderSampleRate, duration);
    }

    const onWorkerMessage = (e: MessageEvent): void => {
        const data = e.data;
        if (!data || typeof data !== "object") return;
        if (data.type !== "decoder-info") return;
        decoderChannels = data.channels;
        decoderSampleRate = data.sampleRate;
        render();
    };
    worker.addEventListener("message", onWorkerMessage);

    const onLoadedMetadata = (): void => {
        render();
    };
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    render();

    return {
        update(m, path) {
            current = m;
            currentPath = path;
            decoderChannels = undefined;
            decoderSampleRate = undefined;
            render();
        },
        destroy() {
            worker.removeEventListener("message", onWorkerMessage);
            audio.removeEventListener("loadedmetadata", onLoadedMetadata);
            current = null;
            currentPath = "";
            decoderChannels = undefined;
            decoderSampleRate = undefined;
            render();
        },
    };
}
