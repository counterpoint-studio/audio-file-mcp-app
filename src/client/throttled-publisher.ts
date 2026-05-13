export type ThrottledPublisher = {
    /**
     * Mark state as changed and request a publish. If `immediate` is true,
     * or no publish has happened within `minIntervalMs`, send now.
     * Otherwise schedule a trailing publish at the end of the window.
     */
    publish(immediate?: boolean): void;
    /** Flush any pending publish synchronously. */
    flush(): void;
    /** Cancel any pending publish; further publish() calls still work. */
    cancel(): void;
    /** Cancel and prevent further sends. */
    destroy(): void;
};

export type ThrottledPublisherOpts = {
    minIntervalMs: number;
    send: () => void;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (id: unknown) => void;
};

export function createThrottledPublisher(opts: ThrottledPublisherOpts): ThrottledPublisher {
    const now = opts.now ?? (() => performance.now());
    const setTimer =
        opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as unknown);
    const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

    let lastSendAt = -Infinity;
    let timerId: unknown = null;
    let destroyed = false;

    function clearTimerIfAny(): void {
        if (timerId !== null) {
            clearTimer(timerId);
            timerId = null;
        }
    }

    function doSend(): void {
        lastSendAt = now();
        try {
            opts.send();
        } catch {
            // swallow; timer state is still valid for future publishes
        }
    }

    return {
        publish(immediate = false): void {
            if (destroyed) return;
            const t = now();
            const elapsed = t - lastSendAt;
            if (immediate || elapsed >= opts.minIntervalMs) {
                clearTimerIfAny();
                doSend();
                return;
            }
            if (timerId !== null) return; // trailing already scheduled
            const delay = opts.minIntervalMs - elapsed;
            timerId = setTimer(() => {
                timerId = null;
                if (destroyed) return;
                doSend();
            }, delay);
        },
        flush(): void {
            if (destroyed) return;
            if (timerId === null) return;
            clearTimerIfAny();
            doSend();
        },
        cancel(): void {
            clearTimerIfAny();
        },
        destroy(): void {
            destroyed = true;
            clearTimerIfAny();
        },
    };
}
