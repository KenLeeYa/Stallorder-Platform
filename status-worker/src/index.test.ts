import { describe, expect, it, vi } from "vitest";
import { createStatusSnapshot, handleRequest } from "./index";

describe("independent status worker", () => {
  it("reports the public services as operational when the primary health check succeeds", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "ok", health: "HEALTHY" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    const snapshot = await createStatusSnapshot({}, fetcher, new Date("2026-08-01T00:00:00.000Z"));

    expect(snapshot.status).toBe("OPERATIONAL");
    expect(snapshot.services.map((service) => service.status)).toEqual([
      "OPERATIONAL",
      "OPERATIONAL",
      "OPERATIONAL",
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("remains available and reports degradation when the primary application is unavailable", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;

    const response = await handleRequest(new Request("https://status.qidaigo.com/"), {}, fetcher);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("部分異常");
    expect(html).toContain("主要服務健康檢查暫時無法通過");
    expect(html).not.toContain("network unavailable");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("publishes only a minimal public JSON projection", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "ok", health: "HEALTHY" }))) as unknown as typeof fetch;
    const response = await handleRequest(
      new Request("https://status.qidaigo.com/api/status"),
      { INCIDENT_SUMMARY: "例行維護", INCIDENT_WORKAROUND: "請稍後重試" },
      fetcher,
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(payload).toHaveProperty("services");
    expect(payload).not.toHaveProperty("projectRef");
    expect(payload).not.toHaveProperty("database");
    expect(JSON.stringify(payload)).not.toContain("token");
  });
});
