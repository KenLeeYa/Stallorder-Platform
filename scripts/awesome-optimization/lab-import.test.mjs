import { afterEach, expect, test, vi } from "vitest";

const boundary = vi.hoisted(() => ({ client: vi.fn(), query: vi.fn(), hook: vi.fn() }));
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  constructor() { boundary.client(); return new Proxy({}, { get: () => boundary.query }); }
} }));
vi.mock("@playwright/test", () => ({
  expect: vi.fn(), errors: {},
  test: Object.assign(vi.fn(), { describe: { configure: boundary.hook }, beforeAll: boundary.hook, afterAll: boundary.hook, beforeEach: boundary.hook }),
}));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

for (const surface of ["admin", "merchant"]) {
  for (const invalid of ["database", "app", "flag"]) {
    test(`actual ${surface} module refuses ${invalid} before clients or request/login hooks`, async () => {
      vi.resetModules();
      vi.stubEnv("RESPONSIVE_QA_RUN", invalid === "flag" ? "false" : "true");
      vi.stubEnv("PLAYWRIGHT_APP_URL", invalid === "app" ? "http://127.0.0.1:3023" : "http://127.0.0.1:3026");
      vi.stubEnv("APP_BASE_URL", "http://127.0.0.1:3026");
      vi.stubEnv("DATABASE_URL", `postgresql://synthetic:synthetic@127.0.0.1:${invalid === "database" ? "55722" : "56822"}/postgres`);
      vi.stubEnv("PRIMARY_SUPABASE_URL", "http://127.0.0.1:56821");
      const request = vi.fn(() => { throw new Error("Unexpected network"); });
      vi.stubGlobal("fetch", request);
      if (surface === "admin") {
        await expect(import("../../e2e/responsive-lab/responsive-admin-workflows.spec.ts")).rejects.toThrow("RESPONSIVE_QA_TARGET_INVALID");
      } else {
        await expect(import("../../e2e/responsive-lab/responsive-merchant-workflows.spec.ts")).rejects.toThrow("RESPONSIVE_QA_TARGET_INVALID");
      }
      expect(boundary.client).not.toHaveBeenCalled();
      expect(boundary.query).not.toHaveBeenCalled();
      expect(boundary.hook).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });
  }
}
