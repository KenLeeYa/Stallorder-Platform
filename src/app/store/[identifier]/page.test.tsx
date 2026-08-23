import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveStorefront: vi.fn(),
  getDisplayMenu: vi.fn(),
  getLiveDisplayMenu: vi.fn(),
  getOrderMenu: vi.fn(),
  getRequestLocale: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn(),
}));

vi.mock("@/components/qr-order-flow", () => ({
  QrOrderFlow: (props: {
    qrToken: string;
    orderingMode: string;
    entryChannel: string;
    initialUiLocale: string;
    requestedLocale: string | null;
  }) => (
    <div
      data-testid="mock-qr-order-flow"
      data-token={props.qrToken}
      data-mode={props.orderingMode}
      data-channel={props.entryChannel}
      data-ui-locale={props.initialUiLocale}
      data-requested-locale={props.requestedLocale ?? ""}
    />
  ),
}));
vi.mock("@/lib/app-locale-server", () => ({
  getRequestAppLocale: mocks.getRequestLocale,
}));
vi.mock("@/lib/public-menu", () => ({
  getCachedPublicDisplayMenuForStallSlug: mocks.getDisplayMenu,
  getLivePublicDisplayMenuForStallSlug: mocks.getLiveDisplayMenu,
  getCachedPublicMenuForQrToken: mocks.getOrderMenu,
}));
vi.mock("@/lib/public-storefront", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/public-storefront")>(),
  resolvePublicStorefront: mocks.resolveStorefront,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("./public-menu-view", () => ({
  PublicMenuView: (props: { menu: { stall: { name: string } }; locale: string }) => (
    <main data-testid="mock-public-menu" data-locale={props.locale}>{props.menu.stall.name}</main>
  ),
}));

import PublicStorefrontPage, { generateMetadata } from "./page";

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    canonicalIdentifier: "viet-food-yc",
    matchedBy: "canonical-code",
    stall: {
      id: "stall-1",
      name: "越好吃一中店",
      slug: "a-hong-he-fen",
      code: "VIET-FOOD-YC",
      location: "台中市",
      currency: "TWD",
      timezone: "Asia/Taipei",
      isActive: true,
      organization: { status: "ACTIVE" },
      orderingSettings: {
        takeoutPreorderEnabled: true,
        deliveryModuleEnabled: true,
      },
      qrCodes: [
        { token: "generic-token", fulfillmentTypeContext: null, expiresAt: null },
      ],
      ...overrides,
    },
  };
}

describe("public storefront page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestLocale.mockResolvedValue({ locale: "zh-TW", hasLocaleCookie: false });
    mocks.resolveStorefront.mockResolvedValue(resolution());
    mocks.getDisplayMenu.mockResolvedValue({
      stall: { name: "越好吃一中店" },
      products: [],
      supportedLocales: ["zh-TW", "vi"],
    });
    mocks.getLiveDisplayMenu.mockImplementation(mocks.getDisplayMenu);
    mocks.getOrderMenu.mockImplementation(async (_token, mode) => ({
      orderingMode: mode,
      supportedLocales: ["zh-TW", "vi"],
    }));
  });

  it("smoke-renders one interface with all modes and a table QR instruction", async () => {
    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("線上 Menu");
    expect(html).toContain("外帶自取");
    expect(html).toContain("外送");
    expect(html).toContain("內用請掃描桌上的 QR Code");
    expect(html).toContain("data-testid=\"mock-public-menu\"");
    expect(html).not.toContain("data-testid=\"mock-qr-order-flow\"");
    expect(mocks.getDisplayMenu).toHaveBeenCalledWith("a-hong-he-fen");
    expect(mocks.getOrderMenu).not.toHaveBeenCalled();
  });

  it("uses ?locale=vi for public chrome while preserving merchant content", async () => {
    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({ locale: "vi" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Menu trực tuyến");
    expect(html).toContain("Tự đến lấy");
    expect(html).toContain("Giao hàng");
    expect(html).toContain("越好吃一中店");
    expect(html).not.toContain("線上 Menu");
  });

  it("automatically follows the phone language when no explicit locale is supplied", async () => {
    mocks.getRequestLocale.mockResolvedValue({ locale: "vi", hasLocaleCookie: false });

    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Menu trực tuyến");
    expect(html).toContain('data-locale="vi"');
    expect(html).not.toContain("線上 Menu");
  });

  it("falls back as a whole instead of mixing Chinese taxonomy into another locale", async () => {
    mocks.getRequestLocale.mockResolvedValue({ locale: "vi", hasLocaleCookie: false });
    mocks.getDisplayMenu.mockResolvedValue({
      stall: { name: "越好吃一中店" },
      products: [],
      supportedLocales: ["zh-TW"],
    });

    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("線上 Menu");
    expect(html).toContain('data-locale="zh-TW"');
    expect(html).not.toContain("Menu trực tuyến");
  });

  it("renders pickup with PREORDER semantics without creating an order", async () => {
    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({ view: "pickup" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("data-token=\"generic-token\"");
    expect(html).toContain("data-mode=\"PREORDER\"");
    expect(html).toContain("data-channel=\"SHARED_LINK\"");
    expect(html).toContain("data-ui-locale=\"zh-TW\"");
    expect(mocks.getOrderMenu).toHaveBeenCalledWith("generic-token", "PREORDER");
    expect(mocks.getOrderMenu).toHaveBeenCalledTimes(1);
    expect(mocks.getDisplayMenu).not.toHaveBeenCalled();
    expect(html).toContain('href="/s/viet-food-yc/schedule?locale=zh-TW"');
    expect(html).toContain("查看出攤行程");
  });

  it("loads only the selected delivery ordering menu", async () => {
    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({ view: "delivery" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("data-mode=\"DELIVERY\"");
    expect(mocks.getOrderMenu).toHaveBeenCalledWith("generic-token", "DELIVERY");
    expect(mocks.getOrderMenu).toHaveBeenCalledTimes(1);
    expect(mocks.getDisplayMenu).not.toHaveBeenCalled();
    expect(html).not.toContain("/s/viet-food-yc/schedule");
  });

  it("disables a mode and explains when its public QR is missing", async () => {
    mocks.resolveStorefront.mockResolvedValue(resolution({
      qrCodes: [{ token: "delivery-token", fulfillmentTypeContext: "DELIVERY", expiresAt: null }],
    }));
    mocks.getOrderMenu.mockImplementation(async (_token, mode) => (
      mode === "DELIVERY" ? { orderingMode: mode } : null
    ));

    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({ view: "pickup" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("目前未開放外帶自取");
    expect(html).toContain("商家尚未建立可供公開連結使用的 QR Code");
    expect(html).toContain("aria-disabled=\"true\"");
    expect(html).toContain('href="/s/viet-food-yc/schedule?locale=zh-TW"');
    expect(mocks.getOrderMenu).not.toHaveBeenCalled();
  });

  it("explains when the selected merchant module is disabled", async () => {
    mocks.resolveStorefront.mockResolvedValue(resolution({
      orderingSettings: { takeoutPreorderEnabled: false, deliveryModuleEnabled: true },
    }));

    const element = await PublicStorefrontPage({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({ view: "pickup" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("尚未開啟外帶自取服務");
  });

  it("redirects a differently cased code to the canonical path with safe query values", async () => {
    mocks.redirect.mockImplementationOnce(() => { throw new Error("REDIRECT"); });

    await expect(PublicStorefrontPage({
      params: Promise.resolve({ identifier: "VIET-FOOD-YC" }),
      searchParams: Promise.resolve({ view: "delivery", locale: "vi", next: "https://attacker.example" }),
    })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/store/viet-food-yc?locale=vi&view=delivery",
    );
  });

  it("redirects an upper-case code path to the exact lower-case canonical path", async () => {
    mocks.redirect.mockImplementationOnce(() => { throw new Error("REDIRECT"); });

    await expect(PublicStorefrontPage({
      params: Promise.resolve({ identifier: "VIET-FOOD-YC" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/store/viet-food-yc");
  });

  it("keeps menu metadata indexable while noindexing ordering views", async () => {
    const menuMetadata = await generateMetadata({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({}),
    });
    const pickupMetadata = await generateMetadata({
      params: Promise.resolve({ identifier: "viet-food-yc" }),
      searchParams: Promise.resolve({ view: "pickup" }),
    });

    expect(menuMetadata).toMatchObject({
      title: "越好吃一中店｜線上 Menu",
      alternates: { canonical: "/store/viet-food-yc" },
    });
    expect(menuMetadata.robots).toBeUndefined();
    expect(pickupMetadata.robots).toEqual({ index: false, follow: false });
  });
});
