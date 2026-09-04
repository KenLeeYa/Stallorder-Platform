import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  createEvent: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findMany: mocks.findMany },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/security", () => ({ hashToken: (value: string) => `hash:${value}` }));
import {
  findReadyPickupOrdersByCode,
  verifyReadyTakeoutOrder,
} from "./pickup-verification-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([{ businessDate: new Date("2026-08-26T00:00:00.000Z") }]);
  mocks.transaction.mockImplementation(async (callback) => callback({
    order: { updateMany: mocks.updateMany },
    orderEvent: { create: mocks.createEvent },
  }));
});

describe("pickup verification service", () => {
  it("limits quick lookup to two matching ready takeout orders", async () => {
    mocks.findMany.mockResolvedValue([{ id: "order-1" }]);

    await expect(findReadyPickupOrdersByCode({ stallId: "stall-1", code: "738" }))
      .resolves.toEqual([{ id: "order-1" }]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stallId: "stall-1",
        pickupCodeServiceDate: new Date("2026-08-26T00:00:00.000Z"),
        fulfillmentType: "TAKEOUT",
        status: "READY",
        pickupVerifiedAt: null,
        pickupCodeLength: 3,
        pickupCodeHash: "hash:738",
      }),
      take: 2,
    }));
  });

  it("does not search outside a valid stall business date", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await expect(findReadyPickupOrdersByCode({ stallId: "stall-1", code: "738" }))
      .resolves.toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("atomically verifies the ready order without closing it", async () => {
    const verifiedAt = new Date("2026-08-26T08:00:00.000Z");
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(verifyReadyTakeoutOrder({
      orderId: "order-1",
      stallId: "stall-1",
      organizationId: "organization-1",
      actorProfileId: "staff-1",
      verificationMethod: "CODE",
      code: "738",
      verifiedAt,
    })).resolves.toEqual({ pickupVerifiedAt: verifiedAt, pickupVerificationMethod: "CODE" });
    expect(mocks.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({
      orderId: "order-1",
      eventType: "PICKUP_CODE_VERIFIED",
      createdBy: "staff-1",
    }) });
  });

  it("does not emit an event when the order changed before verification", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(verifyReadyTakeoutOrder({
      orderId: "order-1",
      stallId: "stall-1",
      organizationId: "organization-1",
      actorProfileId: "staff-1",
      verificationMethod: "CODE",
      code: "738",
    })).resolves.toBeNull();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});
