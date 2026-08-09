import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const now = new Date("2026-07-13T00:05:00Z");
const base = {
  token: "turnstile-token",
  remoteIp: "203.0.113.10",
  idempotencyKey: "77777777-7777-4777-8777-777777777777",
  secret: "test-secret",
  expectedHostname: "order.example.com",
  expectedAction: "public_order",
  now,
};

function siteverify(payload: Record<string, unknown>) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

describe("Turnstile 伺服器驗證", () => {
  it("接受有效且綁定 action/hostname 的短效 token", async () => {
    const result = await verifyTurnstile({
      ...base,
      fetchImpl: siteverify({ success: true, challenge_ts: "2026-07-13T00:04:30Z", hostname: "order.example.com", action: "public_order" }),
    });
    expect(result).toEqual({ ok: true });
  });

  it.each([
    ["偽造 token", { success: false, "error-codes": ["invalid-input-response"] }],
    ["重播或過期 token", { success: false, "error-codes": ["timeout-or-duplicate"] }],
    ["錯誤 action", { success: true, challenge_ts: "2026-07-13T00:04:30Z", hostname: "order.example.com", action: "other" }],
    ["錯誤 hostname", { success: true, challenge_ts: "2026-07-13T00:04:30Z", hostname: "evil.example", action: "public_order" }],
    ["超過五分鐘", { success: true, challenge_ts: "2026-07-12T23:59:00Z", hostname: "order.example.com", action: "public_order" }],
  ])("拒絕%s", async (_label, payload) => {
    const result = await verifyTurnstile({ ...base, fetchImpl: siteverify(payload) });
    expect(result).toMatchObject({ ok: false, code: "INVALID_TURNSTILE" });
  });

  it("Siteverify 無法連線時採 fail closed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(verifyTurnstile({ ...base, fetchImpl })).resolves.toMatchObject({
      ok: false,
      code: "TURNSTILE_UNAVAILABLE",
    });
  });

  it("僅在明確啟用時接受 Cloudflare 官方測試金鑰回應", async () => {
    const fetchImpl = siteverify({
      success: true,
      challenge_ts: "2026-07-13T00:04:30Z",
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    });
    await expect(verifyTurnstile({
      ...base,
      secret: "1x0000000000000000000000000000000AA",
      allowTestKeys: true,
      environment: "development",
      fetchImpl,
    })).resolves.toEqual({ ok: true });
  });

  it("測試環境明確啟用官方 always-pass 私鑰時可離線驗證", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(verifyTurnstile({
      ...base,
      secret: "1x0000000000000000000000000000000AA",
      allowTestKeys: true,
      environment: "test",
      fetchImpl,
    })).resolves.toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("測試環境的一般私鑰在離線時仍採 fail closed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(verifyTurnstile({
      ...base,
      allowTestKeys: true,
      environment: "test",
      fetchImpl,
    })).resolves.toMatchObject({ ok: false, code: "TURNSTILE_UNAVAILABLE" });
  });

  it("正式環境一律拒絕 Cloudflare 官方測試私鑰", async () => {
    const fetchImpl = siteverify({
      success: true,
      challenge_ts: "2026-07-13T00:04:30Z",
      metadata: { result_with_testing_key: true },
    });
    await expect(verifyTurnstile({
      ...base,
      secret: "1x0000000000000000000000000000000AA",
      allowTestKeys: true,
      environment: "production",
      fetchImpl,
    })).resolves.toMatchObject({ ok: false, code: "INVALID_TURNSTILE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
