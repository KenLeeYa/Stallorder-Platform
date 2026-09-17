import { describe, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => vi.fn());
vi.mock("@/server/resilience/health-service", () => ({ checkPrimaryDatabaseHealth: probe }));
import { GET, HEAD } from "./route";
describe("public connectivity", () => {
  it.each([["HEALTHY", 200], ["DEGRADED", 200], ["UNAVAILABLE", 503]])("returns only reachability for %s", async (status, expected) => {
    probe.mockResolvedValue({ status, latencyMs: 23, reasonCode: "private-diagnostic" });
    for (const method of [GET, HEAD]) {
      const response = await method();
      expect(response.status).toBe(expected);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-service-state")).toBe(status === "HEALTHY" ? "ready" : status === "DEGRADED" ? "degraded" : "unavailable");
    }
  });
});
