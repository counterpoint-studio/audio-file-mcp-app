import { describe, it, expect } from "vitest";
import { boundWavBlob, findWavDataBounds } from "./wav-data-bound";

function buildWav(opts: {
    dataBytes: Uint8Array;
    trailing?: Array<{ id: string; payload: Uint8Array }>;
}): Uint8Array {
    const trailing = opts.trailing ?? [];
    let trailingLen = 0;
    for (const t of trailing) {
        trailingLen += 8 + t.payload.byteLength + (t.payload.byteLength & 1);
    }
    const fmtChunkLen = 8 + 16;
    const dataChunkLen = 8 + opts.dataBytes.byteLength;
    const totalRiffPayload = 4 + fmtChunkLen + dataChunkLen + trailingLen;
    const buf = new Uint8Array(8 + totalRiffPayload);
    const dv = new DataView(buf.buffer);
    let p = 0;
    buf.set([0x52, 0x49, 0x46, 0x46], p); // RIFF
    p += 4;
    dv.setUint32(p, totalRiffPayload, true);
    p += 4;
    buf.set([0x57, 0x41, 0x56, 0x45], p); // WAVE
    p += 4;
    // fmt
    buf.set([0x66, 0x6d, 0x74, 0x20], p);
    p += 4;
    dv.setUint32(p, 16, true);
    p += 4;
    dv.setUint16(p, 1, true); // PCM
    dv.setUint16(p + 2, 1, true); // mono
    dv.setUint32(p + 4, 48000, true);
    dv.setUint32(p + 8, 48000 * 2, true);
    dv.setUint16(p + 12, 2, true);
    dv.setUint16(p + 14, 16, true);
    p += 16;
    // data
    buf.set([0x64, 0x61, 0x74, 0x61], p);
    p += 4;
    dv.setUint32(p, opts.dataBytes.byteLength, true);
    p += 4;
    buf.set(opts.dataBytes, p);
    p += opts.dataBytes.byteLength;
    // trailing chunks
    for (const t of trailing) {
        for (let i = 0; i < 4; i++) buf[p + i] = t.id.charCodeAt(i);
        p += 4;
        dv.setUint32(p, t.payload.byteLength, true);
        p += 4;
        buf.set(t.payload, p);
        p += t.payload.byteLength + (t.payload.byteLength & 1);
    }
    return buf;
}

describe("findWavDataBounds", () => {
    it("locates the data chunk start and size", () => {
        const wav = buildWav({ dataBytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
        const b = findWavDataBounds(wav);
        expect(b).not.toBeNull();
        expect(b!.dataSize).toBe(8);
        // RIFF(4) + size(4) + WAVE(4) + fmt(8+16) + data header(8) = 44
        expect(b!.dataStart).toBe(44);
    });

    it("returns null for non-RIFF input", () => {
        expect(findWavDataBounds(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBeNull();
    });

    it("returns null for short input", () => {
        expect(findWavDataBounds(new Uint8Array(4))).toBeNull();
    });

    it("returns null when the head doesn't reach the data chunk", () => {
        const wav = buildWav({
            dataBytes: new Uint8Array(4),
            trailing: [],
        });
        // Build a WAV whose data chunk lives past the scanned head.
        const pre = new Uint8Array(12);
        // Synthesise a header with a huge non-data chunk before data.
        const giantPad = 4096;
        const padded = new Uint8Array(wav.byteLength + 8 + giantPad);
        padded.set(wav.subarray(0, 12), 0);
        // Insert a 'JUNK' chunk after RIFF/WAVE but before fmt.
        let p = 12;
        padded[p] = 0x4a;
        padded[p + 1] = 0x55;
        padded[p + 2] = 0x4e;
        padded[p + 3] = 0x4b;
        new DataView(padded.buffer).setUint32(p + 4, giantPad, true);
        p += 8 + giantPad;
        padded.set(wav.subarray(12), p);
        // Scan only the first 64 bytes.
        expect(findWavDataBounds(padded.subarray(0, 64))).toBeNull();
        void pre;
    });
});

describe("boundWavBlob", () => {
    it("truncates trailing metadata chunks after the data chunk", async () => {
        const data = new Uint8Array(64);
        for (let i = 0; i < data.length; i++) data[i] = i;
        const trailing = new Uint8Array(128);
        trailing.fill(0xaa);
        const wav = buildWav({
            dataBytes: data,
            trailing: [{ id: "bext", payload: trailing }],
        });
        const blob = new Blob([wav]);
        const bounded = await boundWavBlob(blob);
        expect(bounded.size).toBe(44 + 64);
        const back = new Uint8Array(await bounded.arrayBuffer());
        // The last byte should be the final PCM sample, not the trailing padding.
        expect(back[back.length - 1]).toBe(63);
    });

    it("leaves blobs without trailing chunks alone", async () => {
        const wav = buildWav({ dataBytes: new Uint8Array([1, 2, 3, 4]) });
        const blob = new Blob([wav]);
        const bounded = await boundWavBlob(blob);
        expect(bounded.size).toBe(blob.size);
    });

    it("returns the input blob if no WAV header is recognised", async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]);
        const bounded = await boundWavBlob(blob);
        expect(bounded.size).toBe(blob.size);
    });
});
