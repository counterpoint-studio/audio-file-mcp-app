import { describe, it, expect, beforeAll } from "vitest";
import { instantiate } from "../dsp/wasm-dsp.gen";
import { FFT_SIZE, HOP } from "./frame-router";
import {
    BAND_EDGES_HZ,
    WaveformBandEnergyAnalyzer,
} from "./waveform-band-energy";

beforeAll(async () => {
    await instantiate();
});

const SAMPLE_RATE = 44100;

function makeSine(freq: number, amplitude = 1): Float32Array {
    // Raw (unwindowed) sine. WaveformBandEnergyAnalyzer applies its own Hann.
    const out = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
        out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    }
    return out;
}

describe("WaveformBandEnergyAnalyzer", () => {
    it("starts with zero frames and queryRange returns zero energies", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        expect(a.frameCount).toBe(0);
        const e = a.queryRange(0, 1);
        expect(e).toEqual({ low: 0, mid: 0, high: 0 });
    });

    it("attributes a 100 Hz sine to the low band", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        a.onFrame(makeSine(100), 0, SAMPLE_RATE);
        const e = a.queryRange(0, HOP / SAMPLE_RATE);
        expect(e.low).toBeGreaterThan(e.mid);
        expect(e.low).toBeGreaterThan(e.high);
        expect(e.low).toBeGreaterThan(0);
    });

    it("attributes a 1000 Hz sine to the mid band", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        a.onFrame(makeSine(1000), 0, SAMPLE_RATE);
        const e = a.queryRange(0, HOP / SAMPLE_RATE);
        expect(e.mid).toBeGreaterThan(e.low);
        expect(e.mid).toBeGreaterThan(e.high);
        expect(e.mid).toBeGreaterThan(0);
    });

    it("attributes an 8000 Hz sine to the high band", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        a.onFrame(makeSine(8000), 0, SAMPLE_RATE);
        const e = a.queryRange(0, HOP / SAMPLE_RATE);
        expect(e.high).toBeGreaterThan(e.low);
        expect(e.high).toBeGreaterThan(e.mid);
        expect(e.high).toBeGreaterThan(0);
    });

    it("frame count increments with each onFrame call", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        a.onFrame(makeSine(1000), 0, SAMPLE_RATE);
        a.onFrame(makeSine(1000), 1, SAMPLE_RATE);
        a.onFrame(makeSine(1000), 2, SAMPLE_RATE);
        expect(a.frameCount).toBe(3);
    });

    it("queryRange averages across overlapping frames", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        // Two frames at amplitude 1 and amplitude 2 — energy scales as amplitude².
        a.onFrame(makeSine(1000, 1), 0, SAMPLE_RATE);
        a.onFrame(makeSine(1000, 2), 1, SAMPLE_RATE);

        const period = HOP / SAMPLE_RATE;
        const e0 = a.queryRange(0, period * 0.5); // covers frame 0 only
        const e1 = a.queryRange(period, period * 1.5); // covers frame 1 only
        const eAvg = a.queryRange(0, period * 2); // covers both

        // Frame 1 has 4× the mid-band energy of frame 0.
        expect(e1.mid).toBeGreaterThan(e0.mid * 3.5);
        expect(e1.mid).toBeLessThan(e0.mid * 4.5);

        // Average of frame 0 and frame 1 mids.
        const expectedAvg = (e0.mid + e1.mid) / 2;
        expect(eAvg.mid).toBeCloseTo(expectedAvg, 5);
    });

    it("queryRange with no overlap clamps to the nearest frame index", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        a.onFrame(makeSine(1000), 0, SAMPLE_RATE);
        // Range entirely before frame 0 still returns frame 0's energy
        // (i1 forced to i0 + 1 when collapsed).
        const e = a.queryRange(-1, -0.5);
        expect(e.mid).toBeGreaterThan(0);
    });

    it("growable buffer survives past initial capacity", () => {
        const a = new WaveformBandEnergyAnalyzer(2);
        a.init(SAMPLE_RATE);
        const frame = makeSine(1000);
        for (let i = 0; i < 7; i++) {
            a.onFrame(frame, i, SAMPLE_RATE);
        }
        expect(a.frameCount).toBe(7);
        const e = a.queryRange(0, (7 * HOP) / SAMPLE_RATE);
        expect(e.mid).toBeGreaterThan(0);
    });

    it("computes bin bounds with low band ending near the configured cutoff", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        // A 100 Hz sine should land below the 250 Hz cutoff (low band).
        // A 500 Hz sine should land above the low cutoff (mid band).
        a.onFrame(makeSine(100), 0, SAMPLE_RATE);
        const period = HOP / SAMPLE_RATE;
        const low100 = a.queryRange(0, period).low;
        expect(low100).toBeGreaterThan(0);

        const a2 = new WaveformBandEnergyAnalyzer();
        a2.init(SAMPLE_RATE);
        a2.onFrame(makeSine(500), 0, SAMPLE_RATE);
        const e500 = a2.queryRange(0, period);
        expect(e500.mid).toBeGreaterThan(e500.low);
    });

    it("re-initialises bin bounds when sample rate changes via onFrame", () => {
        const a = new WaveformBandEnergyAnalyzer();
        a.init(SAMPLE_RATE);
        // Switch to 48 kHz — verify it does not throw and still appends a frame.
        a.onFrame(makeSine(1000), 0, 48000);
        expect(a.frameCount).toBe(1);
    });

    it("exposes BAND_EDGES_HZ for downstream callers", () => {
        expect(BAND_EDGES_HZ.lowMax).toBe(250);
        expect(BAND_EDGES_HZ.midMax).toBe(4000);
    });
});
