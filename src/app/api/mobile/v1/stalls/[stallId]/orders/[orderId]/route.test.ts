import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeMobileStallRequest = vi.fn();
const findOrder = vi.fn();

vi.mock("@/server/mobile/authorization", () => ({ authorizeMobileStallRequest }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst: findOrder } } }));

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMobileStallRequest.mockResolvedValue({
    ok: true,
    requestId: "11111111-1111-4111-8111-111111111111",
    stall: { id: "22222222-2222-4222-8222-222222222222" },
  });
  findOrder.mockResolvedValue(null);
});

describe("GET /api/mobile/v1/stalls/:stallId/orders/:orderId", () => {
  it("uses both order and authorized stall scope", async () => {
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/mobile/v1/stalls/222/orders/333"),
      { params: Promise.resolve({
        stallId: "22222222-2222-4222-8222-222222222222",
        orderId: "33333333-3333-4333-8333-333333333333",
      }) },
    );

    expect(response.status).toBe(404);
    expect(findOrder).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "33333333-3333-4333-8333-333333333333",
        stallId: "22222222-2222-4222-8222-222222222222",
      },
    }));
  });
});
