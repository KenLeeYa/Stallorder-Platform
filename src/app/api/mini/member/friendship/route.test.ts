import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), refresh: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestPrincipal: mocks.principal, CSRF_COOKIE: "stallorder_csrf" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/server/line-platform/runtime", () => ({ getLinePlatformRuntime: () => ({ environment: "local" }) }));
vi.mock("@/server/line-platform/friendship", () => ({ refreshPlatformFriendship: mocks.refresh }));
import { POST } from "./route";
const origin = "https://mini.local.test", csrf = "synthetic-csrf";
function request(body: unknown = { accessToken: "synthetic-token" }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/mini/member/friendship`, { method: "POST", headers: {
    origin, "content-type": "application/json", "x-csrf-token": csrf, cookie: `stallorder_csrf=${csrf}`, ...headers,
  }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("TRUSTED_APP_ORIGINS", origin);
  mocks.principal.mockResolvedValue({ user: { id: "server-member" }, csrfTokenHash: createHash("sha256").update(csrf).digest("hex") });
  mocks.rate.mockResolvedValue({ allowed: true }); mocks.refresh.mockResolvedValue("FRIEND");
});
afterEach(() => vi.unstubAllEnvs());
describe("member friendship endpoint", () => {
  it("requires session and same-origin CSRF before contacting LINE", async () => {
    mocks.principal.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request(undefined, { "x-csrf-token": "" }))).status).toBe(403);
    expect((await POST(request(undefined, { origin: "https://evil.test" }))).status).toBe(403);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("rejects client identity/status overrides and oversized tokens", async () => {
    for (const body of [{ accessToken: "test", profileId: "forged" }, { accessToken: "test", friendFlag: true }, { accessToken: "x".repeat(4097) }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("returns only server-verified friendship with private response headers", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ friendship: "FRIEND" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.refresh).toHaveBeenCalledWith(expect.objectContaining({ user: { id: "server-member" } }), { environment: "local" }, "synthetic-token");
  });
  it("rate-limits provider refresh separately and hides provider errors", async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    expect((await POST(request())).status).toBe(429); expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.refresh.mockRejectedValue(new Error("provider private error"));
    const response = await POST(request()); expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private error");
  });
});
