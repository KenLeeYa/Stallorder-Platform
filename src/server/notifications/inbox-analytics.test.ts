import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ mode: "ok", events: [] as unknown[], audit: vi.fn(), db: { authSession: { findFirst: vi.fn() }, notificationPreference: { findUnique: vi.fn(), upsert: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() }, committed: false }));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: h.audit }));
vi.mock("@/lib/auth", () => ({ getRequestPrincipal: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ findStallAccess: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: () => true }));
vi.mock("@/server/analytics/product-analytics", async () => { const { createProductAnalytics } = await import("@/server/analytics/analytics-adapter"); return { productAnalytics: createProductAnalytics({ capture(event, signal) { expect(h.committed).toBe(true); if (h.mode === "throw")
            throw Error("sink"); if (h.mode === "reject")
            return Promise.reject(Error("sink")); if (h.mode === "hang")
            return new Promise(() => { }); if (!signal.aborted)
            h.events.push(event); return Promise.resolve(); }, reset() { h.events = []; } }, async () => Boolean((await h.db.notificationPreference.findUnique()).analyticsConsent), () => "actor") }; });
import type { SessionPrincipal } from "@/lib/auth";
import { setInboxPreferences } from "./inbox-service";
import { authenticatedInboxHttp } from "./inbox-http";
const principal = { sessionId: "test", user: { id: "11111111-1111-4111-8111-111111111111" } } as SessionPrincipal;
const original = { version: 1, billingVisible: true, applicationVisible: true, staffOrderVisible: true, analyticsConsent: false };
beforeEach(() => { vi.clearAllMocks(); h.events = []; h.mode = "ok"; h.committed = false; h.db.authSession.findFirst.mockResolvedValue({ profileSessionVersion: 1, profile: { id: principal.user.id, isActive: true, sessionVersion: 1 } }); h.db.notificationPreference.findUnique.mockResolvedValue(original); h.db.notificationPreference.upsert.mockImplementation(async ({ update }) => { const row = { ...original, ...update, version: 2 }; h.db.notificationPreference.findUnique.mockResolvedValue(row); return row; }); h.db.$transaction.mockImplementation(async (fn) => { const result = await fn(h.db); h.committed = true; return result; }); });
afterEach(() => vi.useRealTimers());
describe("durable preference analytics consumer", () => {
    it.each(["throw", "reject", "hang"])("keeps durable successful PATCH within a single 50ms budget with two changed categories and %s sink", async (mode) => { vi.useFakeTimers(); h.mode = mode; const body = { version: 1, billingVisible: false, applicationVisible: false, analyticsConsent: true }; const pending = authenticatedInboxHttp(new Request("http://localhost/api/notification-preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "preferences", undefined, principal, "22222222-2222-4222-8222-222222222222", true); await vi.advanceTimersByTimeAsync(51); const response = await pending; expect(response.status).toBe(200); expect((await response.json()).preferences).toMatchObject({ ...body, version: 2 }); expect(h.db.notificationPreference.upsert).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); });
    it("uses persisted post-write consent and only changed closed categories", async () => { await setInboxPreferences(principal, { version: 1, billingVisible: false, analyticsConsent: true }); expect(h.events).toEqual([{ event: "notification_preference_changed", surface: 1, category: 1, enabled: 0 }]); });
    it("withdrawal clears Test buffers and emits nothing; conflict emits nothing", async () => { h.events = [{ event: "old" }]; await setInboxPreferences(principal, { version: 1, analyticsConsent: false, billingVisible: false }); expect(h.events).toEqual([]); h.db.notificationPreference.findUnique.mockResolvedValue({ ...original, version: 4 }); await expect(setInboxPreferences(principal, { version: 1, analyticsConsent: true })).rejects.toMatchObject({ status: 409 }); expect(h.events).toEqual([]); });
    it("audits retryable Inbox errors without copying error data, even if the audit writer fails", async () => { h.db.notificationPreference.findUnique.mockRejectedValue(Error("private message token")); for (const broken of [false, true]) {
        if (broken)
            h.audit.mockRejectedValue(Error("audit unavailable"));
        const response = await authenticatedInboxHttp(new Request("http://localhost/api/notification-preferences"), "preferences", undefined, principal, "22222222-2222-4222-8222-222222222222", true);
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain("private message");
    } expect(h.audit).toHaveBeenCalledWith({ action: "NOTIFICATION_REQUEST_FAILED", entityType: "NOTIFICATION_INBOX", outcome: "FAILURE", requestId: "22222222-2222-4222-8222-222222222222", actorProfileId: principal.user.id }); });
});
