import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicMenu, PublicMenuProduct } from "@/lib/public-menu-types";
import { PublicMenuView } from "./public-menu-view";

function product(id: string, category: string, group: string | null = null): PublicMenuProduct {
  return {
    id,
    name: category + "商品",
    description: "",
    price: 100,
    kind: "SINGLE",
    category,
    group,
    rank: null,
    isBestSeller: false,
    isSoldOut: false,
    isOrderDiscountEligible: true,
    imageUrl: null,
    translations: [],
    noteGroups: [],
    bundleChoiceGroups: [],
  };
}

describe("PublicMenuView category navigation", () => {
  it("keeps the horizontally scrollable category row sticky and offsets anchors", () => {
    const menu: PublicMenu = {
      orderingMode: "DEFAULT",
      preorderSlots: [],
      lotteryEnabled: false,
      stall: {
        name: "測試攤位",
        slug: "demo",
        coverImageUrl: "https://example.test/banner.webp",
        coverImagePositionX: 42,
        coverImagePositionY: 68,
        coverImageZoom: 125,
        location: "台中市",
        address: "台中市西區測試路 1 號",
        locationGuideImageUrl: "/api/assets/product-images/demo/stall-location-guides/guide.webp",
        currency: "TWD",
        timezone: "Asia/Taipei",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [product("product-1", "主餐"), product("product-2", "飲料")],
      supportedLocales: ["zh-TW"],
      estimatedWaitMinutes: 0,
      estimatedWaitMinMinutes: 0,
      estimatedWaitMaxMinutes: 0,
      waitAcknowledgmentThresholdMinutes: null,
      requiresWaitAcknowledgment: false,
      lastTableOrderAt: null,
      limits: {
        maxItemQuantity: 100,
        maxUniqueProducts: 100,
        maxTotalQuantity: 100,
        maxNoteLength: 1000,
      },
    };

    const html = renderToStaticMarkup(<PublicMenuView menu={menu} locale="zh-TW" />);

    expect(html).toContain('data-testid="public-menu-category-navigation"');
    expect(html).toContain("sticky top-0");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("scroll-mt-20");
    expect(html).toContain('data-testid="public-menu-cover-image"');
    expect(html).toContain("absolute inset-0 -z-10");
    expect(html).toContain("object-position:42% 68%");
    expect(html).toContain("transform:scale(1.25)");
    expect(html).not.toContain("aspect-[3/1]");
    expect(html).toContain("查看地圖與店面指引");
  });

  it("renders named product groups in the supplied catalog order", () => {
    const menu: PublicMenu = {
      orderingMode: "DEFAULT",
      preorderSlots: [],
      lotteryEnabled: false,
      stall: {
        name: "測試攤位",
        slug: "demo",
        location: "台中市",
        currency: "TWD",
        timezone: "Asia/Taipei",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [
        product("product-1", "主餐", "熱食"),
        product("product-2", "主餐", "冷食"),
      ],
      supportedLocales: ["zh-TW"],
      estimatedWaitMinutes: 0,
      estimatedWaitMinMinutes: 0,
      estimatedWaitMaxMinutes: 0,
      waitAcknowledgmentThresholdMinutes: null,
      requiresWaitAcknowledgment: false,
      lastTableOrderAt: null,
      limits: {
        maxItemQuantity: 100,
        maxUniqueProducts: 100,
        maxTotalQuantity: 100,
        maxNoteLength: 1000,
      },
    };

    const html = renderToStaticMarkup(<PublicMenuView menu={menu} locale="zh-TW" />);

    expect(html.indexOf("熱食")).toBeLessThan(html.indexOf("冷食"));
  });

  it("renders translated categories and product groups without Chinese taxonomy fallback", () => {
    const translatedProduct = product("product-1", "湯河粉", "牛肉湯底");
    translatedProduct.categoryTranslations = [{ locale: "vi", name: "Phở nước" }];
    translatedProduct.groupTranslations = [{ locale: "vi", name: "Nước dùng bò" }];
    translatedProduct.translations = [{ locale: "vi", name: "Phở bò", description: "" }];
    const menu: PublicMenu = {
      orderingMode: "DEFAULT",
      preorderSlots: [],
      lotteryEnabled: false,
      stall: {
        name: "Demo Stall",
        slug: "demo",
        location: "Taichung",
        currency: "TWD",
        timezone: "Asia/Taipei",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [translatedProduct],
      supportedLocales: ["zh-TW", "vi"],
      estimatedWaitMinutes: 0,
      estimatedWaitMinMinutes: 0,
      estimatedWaitMaxMinutes: 0,
      waitAcknowledgmentThresholdMinutes: null,
      requiresWaitAcknowledgment: false,
      lastTableOrderAt: null,
      limits: {
        maxItemQuantity: 100,
        maxUniqueProducts: 100,
        maxTotalQuantity: 100,
        maxNoteLength: 1000,
      },
    };

    const html = renderToStaticMarkup(<PublicMenuView menu={menu} locale="vi" />);

    expect(html).toContain("Phở nước");
    expect(html).toContain("Nước dùng bò");
    expect(html).toContain("Phở bò");
    expect(html).not.toContain(">湯河粉<");
    expect(html).not.toContain(">牛肉湯底<");
  });

  it("keeps sold-out products visually unchanged on the display-only Menu", () => {
    const soldOutProduct = product("sold-out", "主餐");
    soldOutProduct.isSoldOut = true;
    soldOutProduct.imageUrl = "https://example.test/sold-out.webp";
    const menu: PublicMenu = {
      orderingMode: "DEFAULT",
      preorderSlots: [],
      lotteryEnabled: false,
      stall: {
        name: "測試攤位",
        slug: "demo",
        location: "台中市",
        currency: "TWD",
        timezone: "Asia/Taipei",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [soldOutProduct],
      supportedLocales: ["zh-TW"],
      estimatedWaitMinutes: 0,
      estimatedWaitMinMinutes: 0,
      estimatedWaitMaxMinutes: 0,
      waitAcknowledgmentThresholdMinutes: null,
      requiresWaitAcknowledgment: false,
      lastTableOrderAt: null,
      limits: {
        maxItemQuantity: 100,
        maxUniqueProducts: 100,
        maxTotalQuantity: 100,
        maxNoteLength: 1000,
      },
    };

    const html = renderToStaticMarkup(<PublicMenuView menu={menu} locale="zh-TW" />);

    expect(html).toContain("主餐商品");
    expect(html).toContain("https://example.test/sold-out.webp");
    expect(html).not.toContain('data-testid="public-menu-sold-out"');
    expect(html).not.toContain("grayscale opacity-45");
    expect(html).not.toContain("售完");
  });
});
