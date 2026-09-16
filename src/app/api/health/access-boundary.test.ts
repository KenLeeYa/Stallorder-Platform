import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("@/lib/authorization", () => ({ authorizePlatformAdminApiRequest: mocks.authorize }));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/server/resilience/health-service", () => ({
  checkPrimaryDatabaseHealth: mocks.probe,
  checkDrDatabaseHealth: mocks.probe,
  getDependencyHealthSnapshot: mocks.probe,
}));

describe("health administrator boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probe.mockResolvedValue({ status: "HEALTHY", checkedAt: "2026-09-16T00:00:00Z" });
  });

  for (const path of ["", "/primary", "/dr", "/dependencies"]) {
    for (const status of [401, 404]) {
      it(`${path || "/"} refuses ${status === 401 ? "anonymous" : "non-admin"} before probing`, async () => {
        mocks.authorize.mockResolvedValue({ ok: false, response: new Response("{}", { status }) });
        const route = path === "" ? await import("./route")
          : path === "/primary" ? await import("./primary/route")
            : path === "/dr" ? await import("./dr/route") : await import("./dependencies/route");
        const response = await route.GET(new Request(`https://app.example/api/health${path}`));
        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(mocks.probe).not.toHaveBeenCalled();
      });
    }

    it(`${path || "/"} remains available to a platform admin`, async () => {
      mocks.authorize.mockResolvedValue({ ok: true, requestId: "health-test" });
      const route = path === "" ? await import("./route")
        : path === "/primary" ? await import("./primary/route")
          : path === "/dr" ? await import("./dr/route") : await import("./dependencies/route");
      const response = await route.GET(new Request(`https://app.example/api/health${path}`));
      expect(response.status).toBe(200);
      expect(mocks.probe).toHaveBeenCalledOnce();
    });
  }
});
