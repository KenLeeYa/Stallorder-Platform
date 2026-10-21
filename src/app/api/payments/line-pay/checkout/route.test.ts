import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), csrf: vi.fn(), checkout: vi.fn(), rate: vi.fn(), owner: vi.fn() }));
vi.mock("@/server/line-platform/member-service",()=>({requirePlatformOrderOwner:mocks.owner}));
vi.mock("@/lib/auth", () => ({ getRequestPrincipal: mocks.principal }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.csrf }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/server/payment-providers/line-platform-payment-workflow", () => ({ platformPaymentWorkflow: () => ({ checkout: mocks.checkout }) }));
import { POST } from "./route";
const body = { orderId: "00000000-0000-4000-8000-000000000001",expectedAmount: 100,orderVersion: "2026-09-27T00:00:00.000Z" };
const request = (value: unknown = body) => new Request("https://qa.example.test/api/payments/line-pay/checkout", { method: "POST",headers: { "content-type": "application/json","x-idempotency-key": "00000000-0000-4000-8000-000000000002" },body: JSON.stringify(value) });
describe("customer LINE Pay checkout API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockResolvedValue({}); mocks.principal.mockResolvedValue({ user: { id: "profile-a" } }); mocks.csrf.mockReturnValue(true); mocks.rate.mockResolvedValue({ allowed: true }); mocks.checkout.mockResolvedValue({ state: "PENDING_AUTH" }); });
  it("rejects unauthenticated and CSRF-invalid callers before durable checkout", async () => {
    mocks.principal.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(401);
    mocks.csrf.mockReturnValueOnce(false); expect((await POST(request())).status).toBe(403);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("rejects client tenant/provider URL injection and uses only the authenticated owner", async () => {
    expect((await POST(request({ ...body,stallId: "other",callbackUrl: "https://evil.example" }))).status).toBe(400);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledWith({ ...body,profileId: "profile-a",idempotencyKey: "00000000-0000-4000-8000-000000000002" });
  });
  it("denies a stale session whose LINE identity or membership was revoked before provider work",async()=>{
    mocks.owner.mockRejectedValueOnce(new Error("LINE_PLATFORM_ORDER_NOT_FOUND"));
    expect((await POST(request())).status).toBe(404);expect(mocks.checkout).not.toHaveBeenCalled();
  });
});
