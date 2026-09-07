import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { request } from "@playwright/test";

loadEnvFile(".env.local");
loadEnvFile("supabase/functions/e2e-runtime.defaults");
for (const [value, port] of [[process.env.DATABASE_URL, "55722"], [process.env.NEXT_PUBLIC_SUPABASE_URL, "55721"]]) {
  const url = new URL(value ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== port) throw new Error("DEDICATED_LOCAL_QA_LAB_REQUIRED");
}
if ([process.env.NODE_ENV, process.env.VERCEL_ENV, process.env.APP_ENV].includes("production")) throw new Error("LOCAL_QA_PRODUCTION_BLOCKED");

const app = "http://127.0.0.1:3018";
const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { getStallModuleState } = await import("../src/lib/stall-modules");
  const { getCapacityManagerData } = await import("../src/lib/capacity");
  const api = await request.newContext({ baseURL: app });
  try {
    const login = await api.post("/api/auth/login", { headers: { origin: app }, data: { email: "owner@stallorder.test", password: "StallOrderDemo!2026" } });
    if (!login.ok()) throw new Error("LOCAL_QA_LOGIN_FAILED");
    const headers = { origin: app, "x-csrf-token": (await api.storageState()).cookies.find(row => row.name === "stallorder_csrf")?.value ?? "" };
    const localFlags = [
      "MODULE_CORE_OPS_ENABLED", "MODULE_HQ_ENABLED", "MODULE_OMNI_ENABLED", "MODULE_GROWTH_ENABLED",
      "MODULE_SUPPLY_LITE_ENABLED", "MODULE_PUBLIC_API_ENABLED", "MODULE_EVENT_GROWTH_ENABLED", "MODULE_ADVANCED_ANALYTICS_ENABLED",
      "DELIVERY_PLATFORM_FOUNDATION_ENABLED", "DELIVERY_PLATFORM_UI_ENABLED", "DELIVERY_MOCK_PROVIDER_ENABLED",
      "DELIVERY_EXTERNAL_ORDER_IMPORT_ENABLED", "DELIVERY_MENU_SYNC_ENABLED", "DELIVERY_PROVIDER_ACTIONS_ENABLED",
      "PAYMENTS_FOUNDATION_ENABLED", "PAYMENTS_ADMIN_UI_ENABLED", "PAYMENTS_MOCK_PROVIDER_ENABLED",
      "PAYMENTS_GATEWAY_ENABLED", "PAYMENTS_RECONCILIATION_ENABLED", "PAYMENTS_REFUNDS_ENABLED",
      "OFFLINE_POS_ENABLED", "OFFLINE_MANUAL_PAYMENT_ENABLED", "AUTH_PASSKEYS_ENABLED",
    ];
    // Dedicated loopback lab only. Live providers, failover and forced degraded mode are not feature demos.
    await prisma.resilienceFeatureFlag.updateMany({ where: { code: { in: localFlags } }, data: { defaultEnabled: true } });
    async function patch(path: string, data: object) {
      const result = await api.patch(path, { headers, data });
      const body = await result.json();
      if (!result.ok()) throw new Error(`LOCAL_QA_SETTINGS_${result.status()} ${path}: ${body.error ?? body.code} ${JSON.stringify(body.fieldErrors ?? {})}`);
      return body;
    }
    const before = (await getStallModuleState(stallId, organizationId)).settings;
    const products = await prisma.stallProduct.findMany({ where: { stallId, isEnabled: true, isSoldOut: false, product: { isActive: true, kind: "SINGLE" } }, orderBy: { sortOrder: "asc" }, select: { productId: true, product: { select: { name: true } } } });
    if (products.length < 3) throw new Error("LOCAL_QA_SELLABLE_PRODUCTS_REQUIRED");
    const productIds = products.slice(0, 3).map(row => row.productId);
    let discount = await prisma.discountOption.findFirst({ where: { stallId, isEnabled: true }, orderBy: { sortOrder: "asc" } });
    if (!discount) {
      await patch(`/api/merchant/stalls/${stallId}/modules`, { operation: "CREATE_DISCOUNT", name: "QA 九折體驗", rateBps: 9000, isEnabled: true, sortOrder: 100 });
      discount = await prisma.discountOption.findFirstOrThrow({ where: { stallId, name: "QA 九折體驗" } });
    }
    const { enabledLocales: _locales, ...modules } = before;
    void _locales;
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const end = new Date(Date.parse(start + "T00:00:00Z") + 7 * 86400_000).toISOString().slice(0, 10);
    const campaigns = modules.lotteryFestivalCampaigns.length ? modules.lotteryFestivalCampaigns : [{
      id: "a7090011-0000-4000-8000-000000000001", name: "本機全功能體驗週", isEnabled: true, startsOn: start, endsOn: end, productIds, sortOrder: 0,
    }];
    await patch(`/api/merchant/stalls/${stallId}/modules`, {
      ...modules, operation: "UPDATE_MODULES", view: "all",
      dineInEnabled: true, deliveryModuleEnabled: true, staffDeliveryEnabled: true,
      printModuleEnabled: true, kdsModuleEnabled: true, paymentModuleEnabled: true, discountModuleEnabled: true,
      takeoutPreorderEnabled: true, checkoutUpsellEnabled: true, checkoutUpsellProductIds: productIds,
      lotteryEnabled: true, lotteryProductIds: productIds,
      lotterySpendRewardEnabled: true, lotterySpendThresholdAmount: 200,
      lotteryDiscountOptionId: discount.id, lotteryDiscountWinRateBps: 2000,
      lotteryDiscountChances: [{ discountOptionId: discount.id, winRateBps: 2000 }],
      lotteryFestivalRewardEnabled: true, lotteryFestivalStartsOn: start, lotteryFestivalEndsOn: end,
      lotteryFestivalCampaigns: campaigns,
      // The birthday feature requires verified member birthdays; its server gate stays authoritative.
      lotteryBirthdayRewardEnabled: false,
    });
    const capacity = await getCapacityManagerData(organizationId, stallId);
    const capacityKeys = ["windowMinutes", "maxOrdersPerWindow", "maxItemsPerWindow", "warningUtilizationPercent", "pauseUtilizationPercent", "defaultPrepMinutes", "minimumQuoteMinutes", "maximumQuoteMinutes", "quoteBufferMinutes", "acknowledgmentThresholdMinutes"] as const;
    const capacitySettings = Object.fromEntries(capacityKeys.map(key => [key, capacity.settings[key]]));
    await patch(`/api/merchant/stalls/${stallId}/capacity`, {
      ...capacitySettings, operation: "UPDATE_SETTINGS", autoPauseEnabled: true, autoResumeEnabled: true, isActive: true,
    });
    await patch(`/api/merchant/stalls/${stallId}/capacity`, { operation: "SET_WAIT_OVERRIDE", minutes: null, reason: "本機 QA 驗證單量自動加時" });
    const displayResponse = await api.get(`/api/merchant/stalls/${stallId}/display`);
    if (!displayResponse.ok()) throw new Error("LOCAL_QA_DISPLAY_UNAVAILABLE");
    const { voiceAvailable, tokenConfigured: _token, ...display } = (await displayResponse.json()).settings;
    void _token;
    await patch(`/api/merchant/stalls/${stallId}/display`, { ...display, operation: "UPDATE_SETTINGS", isActive: true, enableVoice: voiceAvailable, announcementText: "本機 QA 範例：請留意取餐號碼" });
    const after = (await getStallModuleState(stallId, organizationId)).settings;
    const receipt = {
      environment: app, stallId, enabledAt: new Date().toISOString(), before, after,
      capacity: (await getCapacityManagerData(organizationId, stallId)).settings,
      pickupDisplay: { isActive: true, enableVoice: voiceAvailable, url: app + "/display/aming-chicken" },
      recommendationProducts: products.slice(0, 3),
      featureFlags: await prisma.resilienceFeatureFlag.findMany({ where: { code: { in: localFlags } }, select: { code: true, defaultEnabled: true }, orderBy: { code: "asc" } }),
      boundaries: [
        "資料庫硬鎖中的候位、全新預約基礎、動態 QR、線上付款與 CRM 同意基礎仍不可啟用；現有外帶自取預約及既有 QR 不受影響。",
        "壽星抽獎尚無可驗證會員生日，伺服器明確禁止啟用。",
        "第三方付款、外送平台、發票、LINE 推播、AI 翻譯及寄送使用既有模擬／單元測試；不設定真實對外寫入。",
        "瀏覽器語音與列印流程可測試；iPad 鎖屏音效、實體印表機與錢櫃仍須實機確認。",
      ],
    };
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/local-qa-features-20260907.json", JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify({ enabled: true, modules: Object.fromEntries(Object.entries(after).filter(([key]) => key.endsWith("Enabled"))), capacityAutomation: true, pickupDisplay: true }));
  } finally { await api.dispose(); await prisma.$disconnect(); }
}

main().catch(error => {
  // Playwright transport errors append request headers and cookies to the call log.
  console.error(error instanceof Error ? error.message.split(/\r?\n/u)[0] : "LOCAL_QA_ENABLEMENT_FAILED");
  process.exitCode = 1;
});
