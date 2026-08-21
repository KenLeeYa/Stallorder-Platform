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
        location: "台中市",
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
});
