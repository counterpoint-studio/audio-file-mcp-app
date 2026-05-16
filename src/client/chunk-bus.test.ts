import { describe, it, expect } from "vitest";
import { createChunkBus } from "./chunk-bus";

describe("createChunkBus", () => {
    it("fires all subscribers on emit", () => {
        const bus = createChunkBus();
        let a = 0;
        let b = 0;
        bus.subscribe(() => a++);
        bus.subscribe(() => b++);
        bus.emit();
        bus.emit();
        expect(a).toBe(2);
        expect(b).toBe(2);
    });

    it("unsubscribe stops further calls", () => {
        const bus = createChunkBus();
        let n = 0;
        const off = bus.subscribe(() => n++);
        bus.emit();
        off();
        bus.emit();
        expect(n).toBe(1);
    });

    it("subscribe during emit does not fire the new sub in same emission", () => {
        const bus = createChunkBus();
        let nNew = 0;
        bus.subscribe(() => {
            bus.subscribe(() => nNew++);
        });
        bus.emit();
        expect(nNew).toBe(0);
        bus.emit();
        expect(nNew).toBeGreaterThanOrEqual(1);
    });

    it("unsubscribe during emit prevents re-invocation in same emission", () => {
        const bus = createChunkBus();
        let aCount = 0;
        let bCount = 0;
        let offA: (() => void) | null = null;
        offA = bus.subscribe(() => {
            aCount++;
            if (offA) offA();
        });
        bus.subscribe(() => bCount++);
        bus.emit();
        bus.emit();
        // a fires once (then unsubscribes), b fires twice
        expect(aCount).toBe(1);
        expect(bCount).toBe(2);
    });
});
