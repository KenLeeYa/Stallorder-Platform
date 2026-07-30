import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getSnapshot: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizePlatformAdminApiRequest: mocks.authorize,
}));
vi.mock("@/lib/audit", () => ({
  logEvent: mocks.logEvent,
}));
vi.mock("@/server/resilience/health-service", () => ({
  getDependencyHealthSnapshot: mocks.getSnapshot,
}));

describe("/api/health/dependencies", () => {
  it("does not probe or disclose dependencies to an unauthorized request", async () => {
    mocks.authorize.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "找不到指定資源。" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    });
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/health/dependencies"));

    expect(response.status).toBe(404);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns controlled dependency details to a platform admin", async () => {
    mocks.authorize.mockResolvedValue({
      ok: true,
      requestId: "request-id",
      principal: { user: { id: "profile-id", platformRole: "PLATFORM_ADMIN" } },
    });
    mocks.getSnapshot.mockResolvedValue({
      status: "HEALTHY",
      checkedAt: "2026-07-29T00:00:00.000Z",
      dependencies: [{
        key: "primaryDatabase",
        status: "HEALTHY",
        checkedAt: "2026-07-29T00:00:00.000Z",
        latencyMs: 18,
        reasonCode: null,
      }],
    });
    const route = await import("./route");
    const response = await route.GET(new Request("https://example.test/api/health/dependencies"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-id");
    expect(body.dependencies[0]).toMatchObject({
      key: "primaryDatabase",
      status: "HEALTHY",
    });
    expect(JSON.stringify(body)).not.toMatch(/postgresql:|password|secret/i);
  });
});
