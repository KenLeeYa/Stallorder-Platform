import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicMenu: vi.fn(),
  timing: {
    start: vi.fn(() => 0),
    measureDb: vi.fn((operation: () => unknown) => operation()),
    addSince: vi.fn(),
    finish: vi.fn(),
  },
}));

vi.mock("@/components/qr-order-flow", () => ({
  QrOrderFlow: () => null,
}));
vi.mock("@/lib/app-locale-server", () => ({
  getRequestAppLocale: () => Promise.resolve({ locale: "en", hasLocaleCookie: false }),
}));
vi.mock("@/lib/performance-timing", () => ({
  createPerformanceTiming: () => mocks.timing,
}));
vi.mock("@/lib/public-menu", () => ({
  getCachedPublicMenuForQrToken: mocks.getPublicMenu,
}));
vi.mock("@/lib/security", () => ({ createRequestId: () => "request-id" }));

import QrOrderPage from "./page";

describe("physical QR order page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicMenu.mockResolvedValue({ orderingMode: "DEFAULT" });
  });

  it("does not load optional preorder slots during the server render", async () => {
    await QrOrderPage({ params: Promise.resolve({ qrToken: "physical-qr-token" }) });

    expect(mocks.getPublicMenu).toHaveBeenCalledWith(
      "physical-qr-token",
      "DEFAULT",
      { includeOptionalPreorderSlots: false },
    );
  });

  it("passes an explicit ?locale=vi UI locale without tying it to menu translations", async () => {
    const element = await QrOrderPage({
      params: Promise.resolve({ qrToken: "physical-qr-token" }),
      searchParams: Promise.resolve({ locale: "vi" }),
    });

    expect(element.props).toMatchObject({
      initialUiLocale: "en",
      requestedLocale: "vi",
    });
  });

  it("ignores unsupported locale query values", async () => {
    const element = await QrOrderPage({
      params: Promise.resolve({ qrToken: "physical-qr-token" }),
      searchParams: Promise.resolve({ locale: "fr" }),
    });

    expect(element.props).toMatchObject({ initialUiLocale: "en", requestedLocale: null });
  });
});
