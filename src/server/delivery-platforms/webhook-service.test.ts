import { beforeEach, describe, expect, it, vi } from "vitest";

const findConnection = vi.fn();
const assertFeatureEnabled = vi.fn();
const assertDeliveryProviderEnabled = vi.fn();

vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    deliveryPlatformConnection: {
      findFirst: findConnection,
    },
  },
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: {
    assertFeatureEnabled,
  },
}));
vi.mock("./delivery-feature-flags", () => ({
  assertDeliveryProviderEnabled,
}));

beforeEach(() => {
  vi.clearAllMocks();
  findConnection.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    stallId: "33333333-3333-4333-8333-333333333333",
    externalStoreId: "store-001",
    credentialReference: null,
    status: "ACTIVE",
  });
  assertDeliveryProviderEnabled.mockResolvedValue({
    webhook: false,
    importOrders: true,
  });
});

describe("delivery Webhook feature scope", () => {
  it("evaluates provider flags in the resolved organization and stall scope", async () => {
    const { processDeliveryWebhook } = await import("./webhook-service");

    await expect(processDeliveryWebhook({
      provider: "MOCK",
      connectionId: "11111111-1111-4111-8111-111111111111",
      circuit: "CIRCUIT_B_VERCEL",
      request: new Request("https://example.test/api/webhooks/delivery/mock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    })).rejects.toMatchObject({ code: "PROVIDER_DISABLED" });

    expect(assertDeliveryProviderEnabled).toHaveBeenCalledWith("MOCK", {
      organizationId: "22222222-2222-4222-8222-222222222222",
      stallId: "33333333-3333-4333-8333-333333333333",
    });
    expect(assertFeatureEnabled).not.toHaveBeenCalled();
  });
});
