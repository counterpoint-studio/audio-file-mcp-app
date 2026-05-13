import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createThrottledPublisher } from "./throttled-publisher";

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

function makeHarness(minIntervalMs = 1000) {
    const send = vi.fn();
    const p = createThrottledPublisher({ minIntervalMs, send });
    return { send, p };
}

describe("createThrottledPublisher", () => {
    it("sends synchronously on the first publish", () => {
        const { send, p } = makeHarness();
        p.publish();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("collapses many rapid publishes into leading + one trailing", () => {
        const { send, p } = makeHarness(1000);
        p.publish(); // leading send
        for (let i = 0; i < 20; i++) {
            vi.advanceTimersByTime(10);
            p.publish();
        }
        expect(send).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(2000);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("publish(true) cancels pending trailing and resets window", () => {
        const { send, p } = makeHarness(1000);
        p.publish();
        vi.advanceTimersByTime(100);
        p.publish(); // schedules trailing
        vi.advanceTimersByTime(100);
        p.publish(true); // immediate, cancels trailing
        expect(send).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(2000);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("flush sends the pending trailing immediately, otherwise no-op", () => {
        const { send, p } = makeHarness(1000);
        p.flush(); // no pending → no-op
        expect(send).toHaveBeenCalledTimes(0);
        p.publish();
        expect(send).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(50);
        p.publish(); // schedules trailing
        p.flush();
        expect(send).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(2000);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("cancel clears pending trailing without sending", () => {
        const { send, p } = makeHarness(1000);
        p.publish();
        vi.advanceTimersByTime(50);
        p.publish(); // schedule trailing
        p.cancel();
        vi.advanceTimersByTime(2000);
        expect(send).toHaveBeenCalledTimes(1);
        p.publish(); // still works after cancel
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("destroy prevents further sends", () => {
        const { send, p } = makeHarness(1000);
        p.publish();
        p.destroy();
        p.publish();
        p.publish(true);
        p.flush();
        vi.advanceTimersByTime(5000);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("send throwing does not corrupt timer state", () => {
        const send = vi.fn().mockImplementationOnce(() => {
            throw new Error("boom");
        });
        const p = createThrottledPublisher({ minIntervalMs: 1000, send });
        p.publish();
        expect(send).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(50);
        p.publish();
        vi.advanceTimersByTime(2000);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("rapid publishes followed by flush => exactly one trailing send", () => {
        const { send, p } = makeHarness(1000);
        p.publish();
        for (let i = 0; i < 5; i++) {
            vi.advanceTimersByTime(50);
            p.publish();
        }
        p.flush();
        expect(send).toHaveBeenCalledTimes(2);
    });
});
