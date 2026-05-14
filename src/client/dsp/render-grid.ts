import { getInstance, instantiate } from "./wasm-dsp.gen";

type WasmModule = {
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    _malloc(n: number): number;
    _free(p: number): void;
    _render_grid_to_rgba(
        grid: number,
        cols: number,
        numBins: number,
        floorDb: number,
        ceilDb: number,
        ref: number,
        floorValue: number,
        dbMult: number,
        lut: number,
        out: number,
    ): void;
};

export interface GridRenderer {
    render(params: {
        grid: Float32Array;
        decodedCols: number;
        numBins: number;
        floorDb: number;
        ceilDb: number;
        ref: number;
        floorValue: number;
        dbMult: number;
        out: Uint8ClampedArray;
    }): void;
    dispose(): void;
}

class WasmGridRenderer implements GridRenderer {
    private mod: WasmModule;
    private lutPtr = 0;
    private gridPtr = 0;
    private gridFloats = 0;
    private outPtr = 0;
    private outBytes = 0;

    constructor(mod: WasmModule, lut: Uint8ClampedArray) {
        this.mod = mod;
        this.lutPtr = mod._malloc(lut.length);
        if (!this.lutPtr) throw new Error("render-grid LUT _malloc failed");
        // HEAPU8 view fetched fresh in case future mallocs grew memory; not
        // strictly needed for the very first malloc but keeps the pattern uniform.
        mod.HEAPU8.set(lut, this.lutPtr);
    }

    private ensureGrid(floats: number): void {
        if (floats <= this.gridFloats) return;
        if (this.gridPtr) this.mod._free(this.gridPtr);
        const bytes = floats * 4;
        const ptr = this.mod._malloc(bytes);
        if (!ptr) throw new Error(`render-grid grid _malloc(${bytes}) failed`);
        this.gridPtr = ptr;
        this.gridFloats = floats;
    }

    private ensureOut(bytes: number): void {
        if (bytes <= this.outBytes) return;
        if (this.outPtr) this.mod._free(this.outPtr);
        const ptr = this.mod._malloc(bytes);
        if (!ptr) throw new Error(`render-grid out _malloc(${bytes}) failed`);
        this.outPtr = ptr;
        this.outBytes = bytes;
    }

    render(params: {
        grid: Float32Array;
        decodedCols: number;
        numBins: number;
        floorDb: number;
        ceilDb: number;
        ref: number;
        floorValue: number;
        dbMult: number;
        out: Uint8ClampedArray;
    }): void {
        const { grid, decodedCols, numBins, floorDb, ceilDb, ref, floorValue, dbMult, out } = params;
        if (decodedCols <= 0 || numBins <= 0) return;
        const gridFloats = decodedCols * numBins;
        const outBytes = gridFloats * 4;
        if (out.length < outBytes) {
            throw new Error(`out buffer too small: ${out.length} < ${outBytes}`);
        }
        this.ensureGrid(gridFloats);
        this.ensureOut(outBytes);

        const mod = this.mod;
        mod.HEAPF32.set(grid.subarray(0, gridFloats), this.gridPtr >> 2);
        mod._render_grid_to_rgba(
            this.gridPtr,
            decodedCols,
            numBins,
            floorDb,
            ceilDb,
            ref,
            floorValue,
            dbMult,
            this.lutPtr,
            this.outPtr,
        );
        out.set(mod.HEAPU8.subarray(this.outPtr, this.outPtr + outBytes));
    }

    dispose(): void {
        if (this.lutPtr) {
            this.mod._free(this.lutPtr);
            this.lutPtr = 0;
        }
        if (this.gridPtr) {
            this.mod._free(this.gridPtr);
            this.gridPtr = 0;
            this.gridFloats = 0;
        }
        if (this.outPtr) {
            this.mod._free(this.outPtr);
            this.outPtr = 0;
            this.outBytes = 0;
        }
    }
}

export function createGridRenderer(lut: Uint8ClampedArray): GridRenderer {
    return new WasmGridRenderer(getInstance() as WasmModule, lut);
}

export async function createGridRendererAsync(lut: Uint8ClampedArray): Promise<GridRenderer> {
    await instantiate();
    return createGridRenderer(lut);
}
