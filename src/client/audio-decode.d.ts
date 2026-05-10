declare module "audio-decode" {
    export type DecodedChunk = {
        sampleRate: number;
        channelData: Float32Array[];
    };
    type StreamingDecoder = (
        input: ReadableStream<Uint8Array>,
    ) => AsyncIterable<DecodedChunk>;
    type WholeFileDecode = (input: ArrayBuffer | Uint8Array) => Promise<DecodedChunk>;
    const decode: WholeFileDecode & {
        mp3: StreamingDecoder & WholeFileDecode;
        wav: StreamingDecoder & WholeFileDecode;
        flac: StreamingDecoder & WholeFileDecode;
        vorbis: StreamingDecoder & WholeFileDecode;
        opus: StreamingDecoder & WholeFileDecode;
        aac: StreamingDecoder & WholeFileDecode;
        webm: StreamingDecoder & WholeFileDecode;
        aiff: StreamingDecoder & WholeFileDecode;
        qoa: StreamingDecoder & WholeFileDecode;
        caf: StreamingDecoder & WholeFileDecode;
        amr: StreamingDecoder & WholeFileDecode;
        wma: StreamingDecoder & WholeFileDecode;
    };
    export default decode;
}
