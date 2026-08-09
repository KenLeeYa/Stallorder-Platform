import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findStall: vi.fn(),
  getPublicMenu: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/components/qr-order-flow", () => ({ QrOrderFlow: () => null }));
vi.mock("@/lib/prisma", () => ({
  prisma: { stall: { findFirst: mocks.findStall } },
}));
vi.mock("@/lib/public-menu", () => ({
  getCachedPublicMenuForQrToken: mocks.getPublicMenu,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import DeliveryOrderPage from "./page";

describe("fixed delivery order page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findStall.mockResolvedValue({
      name: "測試攤位",
      orderingSettings: { deliveryModuleEnabled: true },
      qrCodes: [{ token: "fixed-delivery-token" }],
    });
    mocks.getPublicMenu.mockResolvedValue({});
  });

  it("selects only the generic non-table QR instead of event or schedule QR codes", async () => {
    await DeliveryOrderPage({ params: Promise.resolve({ stallSlug: "test-stall" }) });

    expect(mocks.findStall).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        qrCodes: expect.objectContaining({
          where: expect.objectContaining({
            diningTableId: null,
            marketEventId: null,
            stallScheduleId: null,
          }),
        }),
      }),
    }));
    expect(mocks.getPublicMenu).toHaveBeenCalledWith("fixed-delivery-token", "DELIVERY");
  });
});
