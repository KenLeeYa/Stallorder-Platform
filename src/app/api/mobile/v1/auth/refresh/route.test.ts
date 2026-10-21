import { beforeEach, describe, expect, it, vi } from "vitest";

const getMobileBearerToken = vi.fn();
const getMobileSessionDeviceId = vi.fn();
const rotateSessionToken = vi.fn();
const recordAuditEvent = vi.fn();
const checkRateLimit = vi.fn();
const resolveMobileFeatureState = vi.fn();

vi.mock("@/lib/auth", () => ({
  getMobileRefreshProfileId: vi.fn().mockResolvedValue("22222222-2222-4222-8222-222222222222"),
  getMobileBearerToken,
  getMobileSessionDeviceId,
  rotateSessionToken,
}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/server/mobile/feature-flags", () => ({ resolveMobileFeatureState }));

beforeEach(() => {
  vi.clearAllMocks();
  resolveMobileFeatureState.mockResolvedValue({ mobileApp: true });
  getMobileBearerToken.mockReturnValue("s".repeat(43));
  getMobileSessionDeviceId.mockReturnValue("11111111-1111-4111-8111-111111111111");
  checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  recordAuditEvent.mockResolvedValue(undefined);
  rotateSessionToken.mockResolvedValue({
    status: "ROTATED",
    profileId: "22222222-2222-4222-8222-222222222222",
    session: {
      id: "33333333-3333-4333-8333-333333333333",
      token: "n".repeat(43),
      expiresAt: new Date("2026-08-26T12:00:00.000Z"),
    },
  });
});

describe("POST /api/mobile/v1/auth/refresh", () => {
  it("rotates the device-bound opaque session", async () => {
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/mobile/v1/auth/refresh"));

    expect(response.status).toBe(200);
    expect(rotateSessionToken).toHaveBeenCalledWith(
      "s".repeat(43),
      expect.objectContaining({ deviceId: "11111111-1111-4111-8111-111111111111" }),
    );
    await expect(response.json()).resolves.toEqual({
      version: "v1",
      session: { token: "n".repeat(43), expiresAt: "2026-08-26T12:00:00.000Z" },
    });
  });

  it("rejects reuse and records the detected session family", async () => {
    rotateSessionToken.mockResolvedValue({
      status: "REUSED",
    });
    const route = await import("./route");
    const response = await route.POST(new Request("https://example.test/api/mobile/v1/auth/refresh"));

    expect(response.status).toBe(401);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "SESSION_REUSE_DETECTED",
    }));
  });
});
