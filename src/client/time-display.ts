export type TimeDisplay = {
    update(progress: number): void;
    destroy(): void;
};

export function createTimeDisplay(
    audio: HTMLAudioElement,
    positionEl: HTMLElement,
    durationEl: HTMLElement,
): TimeDisplay {
    const setPosition = (seconds: number) => {
        positionEl.textContent = formatTime(seconds);
    };

    const setDuration = (seconds: number) => {
        durationEl.textContent = formatTime(seconds);
    };

    const updateDurationFromAudio = () => {
        const { duration } = audio;
        if (Number.isFinite(duration) && duration > 0) {
            setDuration(duration);
        }
    };

    setPosition(0);
    setDuration(0);

    if (audio.readyState >= 1) {
        updateDurationFromAudio();
    }
    audio.addEventListener("loadedmetadata", updateDurationFromAudio);

    return {
        update(progress: number) {
            const { duration } = audio;
            if (!Number.isFinite(duration) || duration <= 0) return;
            const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
            setPosition(clamped * duration);
        },
        destroy() {
            audio.removeEventListener("loadedmetadata", updateDurationFromAudio);
            setPosition(0);
            setDuration(0);
        },
    };
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00.000";
    const totalMs = Math.floor(seconds * 1000);
    const ms = totalMs % 1000;
    const totalSec = Math.floor(totalMs / 1000);
    const sec = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const min = totalMin % 60;
    const hr = Math.floor(totalMin / 60);
    return (
        hr.toString().padStart(2, "0") +
        ":" +
        min.toString().padStart(2, "0") +
        ":" +
        sec.toString().padStart(2, "0") +
        "." +
        ms.toString().padStart(3, "0")
    );
}
