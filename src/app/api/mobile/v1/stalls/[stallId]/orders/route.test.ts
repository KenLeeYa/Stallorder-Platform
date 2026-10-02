import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeMobileStallRequest = vi.fn();
const findOrders = vi.fn();

vi.mock("@/server/mobile/authorization", () => ({ authorizeMobileStallRequest }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findMany: findOrders } } }));

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMobileStallRequest.mockResolvedValue({
    ok: true,
    requestId: "11111111-1111-4111-8111-111111111111",
    stall: { id: "22222222-2222-4222-8222-222222222222" },
  });
  findOrders.mockResolvedValue([{
    id: "33333333-3333-4333-8333-333333333333",
    orderNo: "A-100",
    status: "READY",
    paymentStatus: "PAID",
    fulfillmentType: "TAKEOUT",
    customerName: "測試顧客",
    tableLabel: null,
    total: 25000,
    isTest: false,
    createdAt: new Date("2026-08-25T09:00:00.000Z"),
    updatedAt: new Date("2026-08-25T09:30:00.000Z"),
    _count: { items: 2 },
  }]);
});

describe("GET /api/mobile/v1/stalls/:stallId/orders", () => {
  it("queries only the server-authorized stall and returns a PII-minimized list", async () => {
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/mobile/v1/stalls/untrusted/orders?status=READY&query=A-100"),
      { params: Promise.resolve({ stallId: "untrusted" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findOrders).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stallId: "22222222-2222-4222-8222-222222222222" }),
      take: 31,
    }));
    expect(body.orders[0]).toEqual(expect.objectContaining({
      orderNo: "A-100",
      itemCount: 2,
    }));
    expect(body.orders[0]).not.toHaveProperty("customerPhone");
    expect(body.orders[0]).not.toHaveProperty("deliveryAddress");
  });

  it("rejects unknown query keys without reading orders", async () => {
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/mobile/v1/stalls/222/orders?organizationId=attacker"),
      { params: Promise.resolve({ stallId: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(response.status).toBe(400);
    expect(findOrders).not.toHaveBeenCalled();
  });
});
