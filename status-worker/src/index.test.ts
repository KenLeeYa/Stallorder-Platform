import { describe, expect, it, vi } from "vitest";
import { createStatusSnapshot, handleRequest } from "./index";

describe("independent status worker", () => {
  it("does not treat an unrelated HTTP 200 page as a healthy application", async () => {
    const fetcher = vi.fn(async () => new Response("<html>Sign in</html>", { status: 200 }));
    expect((await createStatusSnapshot({}, fetcher)).status).toBe("DEGRADED");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("preserves degradation when the reachable site reports a slow dependency", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200, headers: { "x-service-state": "degraded" } }));
    expect((await createStatusSnapshot({}, fetcher)).status).toBe("DEGRADED");
  });
  it("supports the existing application until the connectivity route is deployed", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ status: "ok", health: "HEALTHY" }));
    expect((await createStatusSnapshot({}, fetcher)).status).toBe("OPERATIONAL");
    expect(fetcher.mock.calls[1][0]).toBe("https://app.qidaigo.com/api/health");
  });
  it.each([401, 403, 503])("never uses compatibility fallback to hide HTTP %s", async (status) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    expect((await createStatusSnapshot({}, fetcher)).status).toBe("DEGRADED");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("reports the public services as operational when the primary health check succeeds", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "x-service-state": "ready" },
    })) as unknown as typeof fetch;

    const snapshot = await createStatusSnapshot({}, fetcher, new Date("2026-08-01T00:00:00.000Z"));

    expect(snapshot.status).toBe("OPERATIONAL");
    expect(snapshot.services.map((service) => service.status)).toEqual([
      "OPERATIONAL",
      "OPERATIONAL",
      "OPERATIONAL",
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.qidaigo.com/api/connectivity",
      expect.objectContaining({ method: "HEAD", redirect: "manual" }),
    );
  });

  it("does not follow a redirected primary health check", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: "https://example.com/health" },
    })) as unknown as typeof fetch;

    const snapshot = await createStatusSnapshot({}, fetcher);

    expect(snapshot.status).toBe("DEGRADED");
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
    const fetcher = vi.fn(async () => new Response(null, { headers: { "x-service-state": "ready" } })) as unknown as typeof fetch;
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
