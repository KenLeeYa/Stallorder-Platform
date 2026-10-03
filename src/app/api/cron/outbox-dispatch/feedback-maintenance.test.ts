import { afterEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ dispatch: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/server/outbox/outbox-dispatcher", () => ({ processOutboxDispatchCycle: h.dispatch }));
vi.mock("@/server/feedback/feedback-service", () => ({ cleanupExpiredFeedback: h.cleanup }));
import { GET } from "./route";
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("existing dispatcher survives optional feedback maintenance", () => {
    it.each(["throw", "reject", "hang"])("returns original result under cleanup %s", async (mode) => { vi.useFakeTimers(); vi.stubEnv("CRON_SECRET", "unit-only"); h.dispatch.mockResolvedValue({ outcomes: [{ outboxId: "old-owned", status: "SENT" }], domainQuarantined: 0, health: "ok", alerts: [] }); h.cleanup.mockImplementation(() => { if (mode === "throw")
        throw Error("cleanup"); if (mode === "reject")
        return Promise.reject(Error("cleanup")); return new Promise(() => { }); }); const pending = GET(new Request("http://localhost/api/cron/outbox-dispatch", { headers: { authorization: "Bearer unit-only" } })); await vi.advanceTimersByTimeAsync(2001); const response = await pending; expect(response.status).toBe(200); expect(await response.json()).toEqual({ processed: 1, outcomes: [{ outboxId: "old-owned", status: "SENT" }], domainQuarantined: 0, health: "ok", alerts: [] }); expect(h.dispatch).toHaveBeenCalledWith(expect.stringMatching(/^vercel:/), expect.any(Date), 20); expect(vi.getTimerCount()).toBe(0); });
});
