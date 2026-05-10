declare module "audio-type" {
    export type AudioFormat =
        | "wav"
        | "aiff"
        | "mp3"
        | "aac"
        | "flac"
        | "m4a"
        | "opus"
        | "oga"
        | "qoa"
        | "mid"
        | "caf"
        | "wma"
        | "amr"
        | "webm";

    export default function audioType(
        buf: ArrayBuffer | Uint8Array | undefined,
    ): AudioFormat | undefined;
}
