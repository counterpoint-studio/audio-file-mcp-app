// Detects whether the host CSP allows constructing a blob-URL Worker. The
// constructor itself does NOT throw under blocking CSPs in Chromium — the
// worker is created but the script fails to load asynchronously (the CSP
// violation is reported, and the `error` event fires). So the probe spins up
// a trivial worker that posts back, and races a message-roundtrip against a
// timeout backstop and the `error` event.

const PROBE_TIMEOUT_MS = 250;

let cached: Promise<boolean> | null = null;

export function canUseBlobWorker(): Promise<boolean> {
    if (cached === null) cached = probeOnce();
    return cached;
}

function probeOnce(): Promise<boolean> {
    return new Promise((resolve) => {
        let url: string | null = null;
        let worker: Worker | null = null;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const settle = (value: boolean): void => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            try {
                worker?.terminate();
            } catch {
                // ignore
            }
            if (url) URL.revokeObjectURL(url);
            resolve(value);
        };

        try {
            const code = 'self.postMessage("ok")';
            const blob = new Blob([code], { type: "application/javascript" });
            url = URL.createObjectURL(blob);
            worker = new Worker(url);
            worker.onmessage = () => settle(true);
            worker.onerror = () => settle(false);
            timer = setTimeout(() => settle(false), PROBE_TIMEOUT_MS);
        } catch {
            settle(false);
        }
    });
}

/** Test-only: reset the cached probe result. */
export function __resetCanUseBlobWorkerCache(): void {
    cached = null;
}
