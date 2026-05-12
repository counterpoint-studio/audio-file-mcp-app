import type { ParseResult } from "./types";

function isAscii(bytes: Uint8Array, offset: number, str: string): boolean {
    if (offset + str.length > bytes.byteLength) return false;
    for (let i = 0; i < str.length; i++) {
        if (bytes[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
}

export function parseMidi(bytes: Uint8Array): ParseResult {
    if (bytes.byteLength < 14) return null;
    if (!isAscii(bytes, 0, "MThd")) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerSize = dv.getUint32(4, false);
    if (headerSize < 6) return null;
    const format = dv.getUint16(8, false);
    const tracks = dv.getUint16(10, false);
    const division = dv.getInt16(12, false);
    if (format !== 0 && format !== 1 && format !== 2) return null;
    return {
        midiFormatType: format as 0 | 1 | 2,
        midiTrackCount: tracks,
        midiDivision: division,
    };
}
