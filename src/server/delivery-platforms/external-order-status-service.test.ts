import { beforeEach, describe, expect, it, vi } from "vitest";

const externalOrderFindFirst = vi.fn();
const connectionFindFirst = vi.fn();
const assertDeliveryProviderEnabled = vi.fn();
const assertFeatureEnabled = vi.fn();
const acceptOrder = vi.fn();
const enqueueDeliverySyncJob = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    externalOrder: { findFirst: externalOrderFindFirst },
    deliveryPlatformConnection: { findFirst: connectionFindFirst },
  },
}));
vi.mock("./delivery-feature-flags", () => ({ assertDeliveryProviderEnabled }));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled },
}));
vi.mock("./delivery-platform-registry", () => ({
  getDeliveryPlatformAdapter: () => ({
    acceptOrder,
    rejectOrder: vi.fn(),
  }),
}));
vi.mock("./sync-job-service", () => ({ enqueueDeliverySyncJob }));

const externalOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  stallId: "33333333-3333-4333-8333-333333333333",
  connectionId: "44444444-4444-4444-8444-444444444444",
  provider: "MOCK",
  externalOrderId: "external-order-001",
};
const connection = {
  id: externalOrder.connectionId,
  organizationId: externalOrder.organizationId,
  stallId: externalOrder.stallId,
  externalStoreId: "mock-store-001",
  credentialReference: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  externalOrderFindFirst.mockResolvedValue(externalOrder);
  connectionFindFirst.mockResolvedValue(connection);
  assertDeliveryProviderEnabled.mockResolvedValue({ providerActions: true });
  assertFeatureEnabled.mockResolvedValue(undefined);
  acceptOrder.mockResolvedValue(undefined);
});

describe("external order transition acknowledgement", () => {
  it("does not let a provider outage block internal kitchen progress", async () => {
    const { acknowledgeExternalOrderBeforeTransition } = await import(
      "./external-order-status-service"
    );

    await expect(acknowledgeExternalOrderBeforeTransition({
      orderId: "55555555-5555-4555-8555-555555555555",
      nextStatus: "PACKING",
    })).resolves.toMatchObject({
      id: externalOrder.id,
      externalOrderId: externalOrder.externalOrderId,
    });
    expect(assertDeliveryProviderEnabled).not.toHaveBeenCalled();
    expect(connectionFindFirst).not.toHaveBeenCalled();
    expect(acceptOrder).not.toHaveBeenCalled();
  });

  it("requires enabled actions and an active connection before accepting", async () => {
    const { acknowledgeExternalOrderBeforeTransition } = await import(
      "./external-order-status-service"
    );

    await acknowledgeExternalOrderBeforeTransition({
      orderId: "55555555-5555-4555-8555-555555555555",
      nextStatus: "CONFIRMED",
    });

    expect(assertDeliveryProviderEnabled).toHaveBeenCalledOnce();
    expect(assertFeatureEnabled).toHaveBeenCalledWith(
      externalOrder.organizationId,
      "DELIVERY_PLATFORM_INTEGRATIONS",
    );
    expect(acceptOrder).toHaveBeenCalledWith(expect.objectContaining({
      externalOrderId: externalOrder.externalOrderId,
      idempotencyKey: "stallorder:MOCK:external-order-001:CONFIRMED",
    }));
  });

  it("queues a provider update when KDS marks an external order ready", async () => {
    const { persistExternalOrderTransitionForOrder } = await import(
      "./external-order-status-service"
    );
    const transaction = {
      externalOrder: {
        findFirst: vi.fn().mockResolvedValue(externalOrder),
        update: vi.fn().mockResolvedValue(externalOrder),
      },
    };

    await persistExternalOrderTransitionForOrder(
      transaction as never,
      "55555555-5555-4555-8555-555555555555",
      "READY",
    );

    expect(transaction.externalOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: externalOrder.id },
      data: expect.objectContaining({ externalStatus: "READY" }),
    }));
    expect(enqueueDeliverySyncJob).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "ORDER_READY",
      deduplicationKey: "order-action:MOCK:external-order-001:READY",
    }), transaction);
  });
});
