import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "@/components/locale-provider";
import {
  buildPublicStorefrontShare,
  mergeModuleStateAfterCommand,
  StallModulesManager,
  type ModuleState,
} from "@/components/stall-modules-manager";

function moduleState(): ModuleState {
  return {
    settings: {
      dineInEnabled: true,
      deliveryModuleEnabled: false,
      staffDeliveryEnabled: false,
      printModuleEnabled: false,
      kdsModuleEnabled: false,
      paymentModuleEnabled: true,
      discountModuleEnabled: true,
      discountApprovalThresholdBps: 8_000,
      takeoutPreorderEnabled: false,
      preorderMinLeadMinutes: 15,
      preorderMaxDays: 7,
      preorderSlotMinutes: 15,
      lotteryEnabled: false,
      lotteryDiscountOptionId: "discount-1",
      lotteryDiscountWinRateBps: 1_000,
      lotteryDiscountChances: [{ discountOptionId: "discount-1", winRateBps: 1_000 }],
      lotterySpendRewardEnabled: false,
      lotterySpendThresholdAmount: 666,
      lotteryFestivalRewardEnabled: false,
      lotteryFestivalStartsOn: null,
      lotteryFestivalEndsOn: null,
      lotteryBirthdayRewardEnabled: false,
      enabledLocales: ["zh-TW"],
    },
    floors: [{ id: "floor-1", name: "1樓", sortOrder: 1 }],
    tables: [{
      id: "table-1",
      floorId: "floor-1",
      code: "A1",
      label: "A1桌",
      isActive: true,
      sortOrder: 1,
      layoutX: 0,
      layoutY: 0,
      shape: "SQUARE",
      rotationDegrees: 0,
      qrCode: null,
    }],
    paymentOptions: [{
      id: "payment-1",
      code: "CASH",
      name: "現金",
      kind: "CASH",
      isEnabled: true,
      sortOrder: 1,
    }],
    discounts: [{
      id: "discount-1",
      name: "九折",
      rateBps: 9_000,
      isEnabled: true,
      sortOrder: 1,
    }],
  };
}

describe("mergeModuleStateAfterCommand", () => {
  it("新增樓層後保留其他尚未儲存的抽抽樂設定", () => {
    const saved = moduleState();
    const draft = structuredClone(saved);
    draft.settings.lotteryEnabled = true;
    draft.settings.lotteryDiscountChances[0].winRateBps = 2_000;
    const server = structuredClone(saved);
    server.floors.push({ id: "floor-2", name: "2樓", sortOrder: 2 });

    const merged = mergeModuleStateAfterCommand(draft, saved, server, {
      operation: "CREATE_FLOOR",
      name: "2樓",
      sortOrder: 2,
    });

    expect(merged.floors).toHaveLength(2);
    expect(merged.settings.lotteryEnabled).toBe(true);
    expect(merged.settings.lotteryDiscountChances[0].winRateBps).toBe(2_000);
  });

  it("儲存模組設定時保留尚未儲存的 QR 語系", () => {
    const saved = moduleState();
    const draft = structuredClone(saved);
    draft.settings.deliveryModuleEnabled = true;
    draft.settings.enabledLocales = ["zh-TW", "en"];
    const server = structuredClone(saved);
    server.settings.deliveryModuleEnabled = true;

    const merged = mergeModuleStateAfterCommand(draft, saved, server, {
      operation: "UPDATE_MODULES",
    });

    expect(merged.settings.deliveryModuleEnabled).toBe(true);
    expect(merged.settings.enabledLocales).toEqual(["zh-TW", "en"]);
  });

  it("停用折扣時不會保留已失效的抽抽樂獎項", () => {
    const saved = moduleState();
    const draft = structuredClone(saved);
    draft.settings.lotteryDiscountChances[0].winRateBps = 2_000;
    const server = structuredClone(saved);
    server.discounts[0].isEnabled = false;
    server.settings.lotteryDiscountOptionId = null;
    server.settings.lotteryDiscountWinRateBps = 0;
    server.settings.lotteryDiscountChances = [];

    const merged = mergeModuleStateAfterCommand(draft, saved, server, {
      operation: "UPDATE_DISCOUNT",
      discountId: "discount-1",
    });

    expect(merged.discounts[0].isEnabled).toBe(false);
    expect(merged.settings.lotteryDiscountChances).toEqual([]);
    expect(merged.settings.lotteryDiscountOptionId).toBeNull();
  });
});

describe("buildPublicStorefrontShare", () => {
  it("uses the lower-case stall code for one shared public URL and LINE reply", () => {
    const share = buildPublicStorefrontShare("https://app.qidaigo.com/", "VIET-FOOD-YC");

    expect(share.storefrontUrl).toBe("https://app.qidaigo.com/store/viet-food-yc");
    expect(share.lineReply).toContain("線上 Menu、外帶自取或外送");
    expect(share.lineReply.match(/https:\/\/app\.qidaigo\.com/g)).toHaveLength(1);
    expect(share.lineReply).not.toContain("/s/");
    expect(share.lineReply).not.toContain("/delivery/");
    expect(share.lineReply).not.toContain("外帶預約");
  });

  it("renders one customer URL field with the unified pickup label", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, {
      initialLocale: "zh-TW",
      hasLocaleCookie: true,
    } as Parameters<typeof LocaleProvider>[0], createElement(StallModulesManager, {
        stallId: "stall-1",
        stallCode: "VIET-FOOD-YC",
        appUrl: "https://app.qidaigo.com",
        initialState: moduleState(),
    })));

    expect(html.match(/https:\/\/app\.qidaigo\.com\/store\/viet-food-yc/g)).toHaveLength(2);
    expect(html.match(/顧客公開點餐網址/g)).toHaveLength(1);
    expect(html).toContain("外帶自取");
    expect(html).not.toContain("顧客外帶預約網址");
    expect(html).not.toContain("顧客外送網址");
  });

  it("keeps every stall setting section visible without accordion controls", () => {
    const html = renderToStaticMarkup(createElement(LocaleProvider, {
      initialLocale: "zh-TW",
      hasLocaleCookie: true,
    } as Parameters<typeof LocaleProvider>[0], createElement(StallModulesManager, {
      stallId: "stall-1",
      stallCode: "VIET-FOOD-YC",
      appUrl: "https://app.qidaigo.com",
      initialState: moduleState(),
    })));

    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain('data-testid="stall-modules-toggle-all"');
    expect(html).toContain("營運模組與內用桌位");
    expect(html).toContain("外帶、外送與 LINE 連結");
    expect(html).toContain("桌位平面配置");
  });
});
