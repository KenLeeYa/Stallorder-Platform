import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductAnalytics, createTestAnalytics, noopAnalytics } from "./analytics-adapter";
const event = { event: "feedback_submitted", surface: 1, kind: 1, outcome: 1 } as const;
afterEach(() => vi.useRealTimers());
describe("closed optional analytics", () => {
    it.each([{ ...event, email: "x@y.test" }, { ...event, surface: "WEB" }, { ...event, kind: NaN }, { ...event, kind: Infinity }, { ...event, payload: { message: "private" } }, { ...event, url: "/token" }])("rejects unknown/PII/nonliteral data before consent and Noop", async (input) => {
        const consent = vi.fn(async () => false), capture = createProductAnalytics(noopAnalytics, consent, String).capture;
        await expect(capture("actor", input)).rejects.toThrow();
        expect(consent).not.toHaveBeenCalled();
    });
    it("keeps default OFF and isolates lookup failure", async () => {
        const sink = createTestAnalytics();
        await createProductAnalytics(sink, async () => false, String).capture("a", event);
        await createProductAnalytics(sink, async () => { throw Error("offline"); }, String).capture("a", event);
        expect(sink.flush()).toEqual([]);
    });
    it("bounds Test memory at 100 and flush/reset clear it", async () => {
        const sink = createTestAnalytics(), analytics = createProductAnalytics(sink, async () => true, String);
        for (let i = 0; i < 105; i++)
            await analytics.capture("a", event);
        expect(sink.flush()).toHaveLength(100);
        expect(sink.flush()).toEqual([]);
        await analytics.capture("a", event);
        analytics.invalidate("a");
        expect(sink.flush()).toEqual([]);
    });
    it("withdrawal/logout cancels a consent lookup already pending and never transfers it to B", async () => {
        let finish!: (value: boolean) => void;
        const sink = createTestAnalytics(), analytics = createProductAnalytics(sink, () => new Promise<boolean>(resolve => { finish = resolve; }), String);
        const pending = analytics.capture("a", event);
        await Promise.resolve();
        analytics.invalidate("a");
        finish(true);
        await pending;
        expect(sink.flush()).toEqual([]);
    });
    it.each(["throw", "reject", "hang"])("isolates %s without exceeding the 50ms budget", async (mode) => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        const analytics = createProductAnalytics({ capture: (_event, s) => { signal = s; if (mode === "throw")
                throw Error("sink"); if (mode === "reject")
                return Promise.reject(Error("sink")); return new Promise(() => { }); }, reset() { } }, async () => true, String);
        let done = false;
        const pending = analytics.capture("a", event).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(50);
        await pending;
        expect(done).toBe(true);
        expect(signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
