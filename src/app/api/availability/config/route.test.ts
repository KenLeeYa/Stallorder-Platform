import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAvailabilityConfig: vi.fn(),
}));

vi.mock("@/server/resilience/availability-config-service", () => ({
  getAvailabilityConfig: mocks.getAvailabilityConfig,
}));

describe("/api/availability/config", () => {
  it("returns only the safe runtime contract without sharing a device rollout", async () => {
    mocks.getAvailabilityConfig.mockResolvedValue({
      mode: "NORMAL_PRIMARY",
      activeBackend: "PRIMARY",
      promotionEpoch: 3,
      orderIntake: "DUAL",
      qrOrdering: "AVAILABLE",
      staffOnline: "AVAILABLE",
      offlinePos: "MAINTENANCE",
      linePay: "MAINTENANCE",
      jkoPay: "MAINTENANCE",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    const route = await import("./route");
    const response = await route.GET(new Request("https://app.qidaigo.com/api/availability/config", {
      headers: {
        "x-stallorder-device-id": "11111111-1111-4111-8111-111111111111",
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      mode: "NORMAL_PRIMARY",
      activeBackend: "PRIMARY",
      promotionEpoch: 3,
      orderIntake: "DUAL",
      qrOrdering: "AVAILABLE",
      staffOnline: "AVAILABLE",
      offlinePos: "MAINTENANCE",
      linePay: "MAINTENANCE",
      jkoPay: "MAINTENANCE",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    expect(mocks.getAvailabilityConfig).toHaveBeenCalledWith(
      expect.any(String),
      { deviceId: "11111111-1111-4111-8111-111111111111" },
    );
    expect(JSON.stringify(body)).not.toMatch(/database|project|secret|token|url/i);
  });
});
