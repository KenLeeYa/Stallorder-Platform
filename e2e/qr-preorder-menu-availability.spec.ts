import { expect, test, type Page } from "@playwright/test";
import { buildFulfillmentTimeSlots } from "../src/lib/fulfillment-time-options";

const testTimeZone = "Asia/Taipei";
const firstPickupSlot = "2099-08-03T04:00:00.000Z";
const secondPickupSlot = "2099-08-03T04:30:00.000Z";
const fiveMinutePickupSlot = "2099-08-03T04:05:00.000Z";
const slotBoundary = "2099-08-03T04:15:00.000Z";

function fulfillmentSlot(iso: string) {
  const slot = buildFulfillmentTimeSlots([iso], testTimeZone)[0];
  if (!slot) throw new Error(`測試時段 ${iso} 必須是有效的 5 分鐘單位。`);
  return slot;
}

async function selectFulfillmentSlot(
  page: Page,
  testId: string,
  labels: { date: string; time: string },
  iso: string,
) {
  const slot = fulfillmentSlot(iso);
  const fields = page.getByTestId(testId);
  await fields.getByLabel(labels.date).fill(slot.date);
  await fields.getByLabel(`${labels.time}－時`).selectOption(slot.hour);
  await fields.getByLabel(`${labels.time}－分`).selectOption(slot.minute);
  return { fields, slot };
}

const availableConfig = {
  mode: "NORMAL_PRIMARY",
  activeBackend: "PRIMARY",
  promotionEpoch: 1,
  orderIntake: "EDGE_PRIMARY",
  qrOrdering: "AVAILABLE",
  staffOnline: "AVAILABLE",
  offlinePos: "AVAILABLE",
  linePay: "AVAILABLE",
  jkoPay: "AVAILABLE",
  updatedAt: "2099-08-03T00:00:00.000Z",
};

const baseProduct = {
  description: "預約時段供應測試商品",
  category: "預約餐點",
  rank: null,
  isBestSeller: false,
  imageUrl: null,
  translations: [],
  noteGroups: [],
};

test("分享外帶連結依取餐時段更新商品與套餐選項並清除失效購物車", async ({ page }) => {
  let sessionExpiresSoon = false;
  await page.route("**/api/availability/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(availableConfig),
    });
  });

  await page.route("**/create-order-session", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        orderSessionToken: `stos_${"p".repeat(43)}`,
        expiresAt: new Date(Date.now() + (sessionExpiresSoon ? 30_000 : 10 * 60_000)).toISOString(),
        orderingMode: "PREORDER",
        preorderSlots: [firstPickupSlot, secondPickupSlot],
        // PREORDER must hide lottery UI even if an older session payload still enables it.
        lotteryEnabled: true,
        stall: {
          name: "預約時段測試攤位",
          slug: "preorder-availability-e2e",
          location: "測試夜市",
          currency: "TWD",
          timezone: testTimeZone,
          fulfillmentType: "TAKEOUT",
          table: null,
        },
        products: [
          {
            ...baseProduct,
            id: "morning-item",
            name: "早鳥飯糰",
            price: 100,
            kind: "SINGLE",
            availableFrom: "2099-08-03T03:00:00.000Z",
            availableUntil: slotBoundary,
            bundleChoiceGroups: [],
          },
          {
            ...baseProduct,
            id: "later-item",
            name: "晚場便當",
            price: 120,
            kind: "SINGLE",
            availableFrom: slotBoundary,
            availableUntil: "2099-08-03T06:00:00.000Z",
            bundleChoiceGroups: [],
          },
          {
            ...baseProduct,
            id: "slot-bundle",
            name: "時段限定套餐",
            price: 150,
            kind: "BUNDLE",
            availableFrom: "2099-08-03T03:00:00.000Z",
            availableUntil: "2099-08-03T06:00:00.000Z",
            bundleChoiceGroups: [{
              id: "drink-group",
              name: "搭配飲品",
              minSelections: 1,
              maxSelections: 1,
              sortOrder: 0,
              options: [
                {
                  id: "morning-drink",
                  componentProductId: "morning-tea",
                  componentProductName: "晨間紅茶",
                  quantity: 1,
                  priceDelta: 20,
                  sortOrder: 0,
                  availableFrom: "2099-08-03T03:00:00.000Z",
                  availableUntil: slotBoundary,
                },
                {
                  id: "later-drink",
                  componentProductId: "later-tea",
                  componentProductName: "晚場綠茶",
                  quantity: 1,
                  priceDelta: 30,
                  sortOrder: 1,
                  availableFrom: slotBoundary,
                  availableUntil: "2099-08-03T06:00:00.000Z",
                },
              ],
            }],
          },
        ],
        supportedLocales: ["zh-TW"],
        estimatedWaitMinutes: 0,
        estimatedWaitMinMinutes: 0,
        estimatedWaitMaxMinutes: 0,
        waitAcknowledgmentThresholdMinutes: null,
        requiresWaitAcknowledgment: false,
        lastTableOrderAt: null,
        limits: {
          maxItemQuantity: 20,
          maxUniqueProducts: 20,
          maxTotalQuantity: 50,
          maxNoteLength: 300,
        },
      }),
    });
  });

  await page.route("**/create-public-order", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        orderNo: "P001",
        trackingToken: `stot_${"p".repeat(43)}`,
      }),
    });
  });

  await page.goto("/s/aming-chicken");

  await expect(page.getByRole("heading", { name: "預約時段測試攤位" })).toBeVisible();
  await expect(page.getByText("目前為非營業時間，僅接受預約外帶。", { exact: true })).toBeVisible();
  const initialPickupSlot = fulfillmentSlot(firstPickupSlot);
  const preorderFields = page.getByTestId("qr-preorder-fulfillment-time-fields");
  const preorderDate = preorderFields.getByLabel("預約取餐日期");
  const preorderHour = preorderFields.getByLabel("預約取餐時間－時");
  const preorderMinute = preorderFields.getByLabel("預約取餐時間－分");
  await expect(preorderDate).toHaveAttribute("type", "date");
  await expect(preorderDate).toHaveValue(initialPickupSlot.date);
  await expect(preorderHour).toHaveValue(initialPickupSlot.hour);
  await expect(preorderMinute).toHaveValue(initialPickupSlot.minute);
  for (const control of [preorderDate, preorderHour, preorderMinute]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const applyPickupTime = page.getByRole("button", { name: "套用這個時間", exact: true });
  await expect(page.getByText("請先確認並套用預約取餐時間，完成後才會顯示可點商品。", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(applyPickupTime).toBeEnabled();
  await applyPickupTime.click();

  await expect(page.getByRole("article").filter({ hasText: "早鳥飯糰" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "晚場便當" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "抽抽樂推薦" })).toHaveCount(0);

  const bundle = page.locator("article#qr-product-slot-bundle");
  await bundle.getByRole("button", { name: "增加 時段限定套餐" }).click();
  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晚場綠茶/ })).toHaveCount(0);
  await bundle.getByRole("radio", { name: /晨間紅茶/ }).check();
  await expect(bundle).toContainText("$170");
  await bundle.getByRole("button", { name: "加入購物車" }).click();

  const morningItem = page.locator("article#qr-product-morning-item");
  await morningItem.getByRole("button", { name: "增加 早鳥飯糰" }).click();
  const cart = page.getByTestId("qr-cart-panel");
  await expect(cart).toContainText("共 2 份");
  await expect(cart).toContainText("$270");

  await selectFulfillmentSlot(page, "qr-preorder-fulfillment-time-fields", {
    date: "預約取餐日期",
    time: "預約取餐時間",
  }, secondPickupSlot);

  await expect(page.getByText("尚未套用新的取餐時間；套用後才會更新可點商品與購物車。", { exact: true })).toBeVisible();
  await expect(morningItem).toBeVisible();
  await expect(page.locator("article#qr-product-later-item")).toHaveCount(0);
  await expect(cart).toContainText("共 2 份");
  await expect(cart).toContainText("$270");
  const checkoutBlocker = page.getByTestId("qr-checkout-blocker");
  const submitOrder = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(checkoutBlocker).toHaveAttribute("role", "status");
  await expect(checkoutBlocker).toHaveText("取餐時間尚未套用，請先按下「套用這個時間」。");
  await expect(submitOrder).toBeDisabled();
  await expect(applyPickupTime).toBeEnabled();
  await applyPickupTime.click();

  await expect(page.getByRole("article").filter({ hasText: "早鳥飯糰" })).toHaveCount(0);
  await expect(page.getByRole("article").filter({ hasText: "晚場便當" })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).toHaveCount(0);
  await expect(bundle.getByRole("radio", { name: /晚場綠茶/ })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晚場綠茶/ })).not.toBeChecked();
  await expect(bundle).toContainText("$150");
  await expect(cart).toContainText("共 1 份");
  await expect(cart).toContainText("$150");
  await expect(checkoutBlocker).toHaveText("請完成「時段限定套餐」的必選註記。");
  await expect(submitOrder).toBeDisabled();
  await expect(page.getByRole("region", { name: "抽抽樂推薦" })).toHaveCount(0);
  await bundle.getByRole("dialog", { name: "時段限定套餐" }).getByRole("button", { name: "關閉" }).click();

  await selectFulfillmentSlot(page, "qr-preorder-fulfillment-time-fields", {
    date: "預約取餐日期",
    time: "預約取餐時間",
  }, firstPickupSlot);
  await page.getByRole("button", { name: "套用這個時間", exact: true }).click();

  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).not.toBeChecked();
  await expect(cart).toContainText("共 1 份");
  await expect(cart).toContainText("$150");
  await bundle.getByRole("dialog", { name: "時段限定套餐" }).getByRole("button", { name: "關閉" }).click();

  await selectFulfillmentSlot(page, "qr-preorder-fulfillment-time-fields", {
    date: "預約取餐日期",
    time: "預約取餐時間",
  }, secondPickupSlot);
  await page.getByRole("button", { name: "套用這個時間", exact: true }).click();
  await bundle.getByRole("dialog", { name: "時段限定套餐" }).getByRole("button", { name: "關閉" }).click();
  const bundleCartLine = page.getByTestId("qr-cart-line").filter({ hasText: "時段限定套餐" });
  await bundleCartLine.getByRole("button", { name: "移除", exact: true }).click();
  const laterItem = page.locator("article#qr-product-later-item");
  await laterItem.getByRole("button", { name: "增加 晚場便當" }).click();

  await expect.poll(() => page.evaluate(() => {
    const raw = Object.entries(window.localStorage)
      .find(([key]) => key.startsWith("stallorder_qr_cart:") && key.endsWith(":preorder"))?.[1];
    if (!raw) return null;
    const draft = JSON.parse(raw) as {
      orderingMode?: string;
      scheduledPickupAt?: string;
      lines?: Array<{ productId?: string }>;
    };
    return {
      orderingMode: draft.orderingMode,
      scheduledPickupAt: draft.scheduledPickupAt,
      productIds: draft.lines?.map((line) => line.productId),
    };
  })).toEqual({
    orderingMode: "PREORDER",
    scheduledPickupAt: secondPickupSlot,
    productIds: ["later-item"],
  });

  sessionExpiresSoon = true;
  await page.reload();
  const expiryDialog = page.getByTestId("qr-session-expiry-dialog");
  await expect(expiryDialog).toHaveAttribute("data-expired", "false");
  sessionExpiresSoon = false;
  await Promise.all([
    page.waitForEvent("load"),
    expiryDialog.getByRole("button", { name: "重新整理並繼續點餐" }).click(),
  ]);
  await expect(expiryDialog).toHaveCount(0);
  await expect(preorderDate).toHaveValue(fulfillmentSlot(secondPickupSlot).date);
  await expect(preorderHour).toHaveValue(fulfillmentSlot(secondPickupSlot).hour);
  await expect(preorderMinute).toHaveValue(fulfillmentSlot(secondPickupSlot).minute);
  await expect(page.locator("article#qr-product-later-item")).toBeVisible();
  await expect(cart).toContainText("共 1 份");
  await expect(cart).toContainText("$120");

  const orderRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname.endsWith("/create-public-order")
    && request.method() === "POST"
  ));
  const submit = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  expect((await orderRequest).postDataJSON()).toMatchObject({
    orderingMode: "PREORDER",
    scheduledPickupAt: secondPickupSlot,
  });
});

test("營業中的實體 QR 不顯示取餐時間且送單固定為即時外帶", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/availability/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(availableConfig),
    });
  });
  await page.route("**/create-order-session", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        orderSessionToken: `stos_${"t".repeat(43)}`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        orderingMode: "DEFAULT",
        preorderSlots: [firstPickupSlot, fiveMinutePickupSlot],
        lotteryEnabled: false,
        stall: {
          name: "外帶時間測試店",
          slug: "takeaway-time-e2e",
          location: "台北市",
          currency: "TWD",
          timezone: "Asia/Taipei",
          fulfillmentType: "TAKEOUT",
          table: null,
        },
        products: [{
          ...baseProduct,
          id: "takeaway-item",
          name: "外帶測試餐",
          price: 100,
          kind: "SINGLE",
          availableFrom: null,
          availableUntil: null,
          bundleChoiceGroups: [],
        }],
        supportedLocales: ["zh-TW"],
        estimatedWaitMinutes: 10,
        estimatedWaitMinMinutes: 10,
        estimatedWaitMaxMinutes: 10,
        waitAcknowledgmentThresholdMinutes: null,
        requiresWaitAcknowledgment: false,
        lastTableOrderAt: null,
        limits: {
          maxItemQuantity: 20,
          maxUniqueProducts: 20,
          maxTotalQuantity: 50,
          maxNoteLength: 300,
        },
      }),
    });
  });
  await page.route("**/create-public-order", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        orderNo: "T001",
        trackingToken: `stot_${"x".repeat(43)}`,
      }),
    });
  });

  await page.goto(`/q/takeaway-time-${Date.now()}`);
  const product = page.getByRole("article").filter({ hasText: "外帶測試餐" });
  await product.getByRole("button", { name: "增加 外帶測試餐" }).click();
  await page.getByTestId("qr-mobile-cart-summary").click();
  await expect(page.getByRole("radio", { name: "儘快，不指定時間" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "指定取餐時間" })).toHaveCount(0);
  await expect(page.locator('[data-testid$="fulfillment-time-fields"]')).toHaveCount(0);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();

  const orderRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname.endsWith("/create-public-order")
    && request.method() === "POST"
  ));
  await page.getByRole("button", { name: "送出訂單", exact: true }).click();
  const body = (await orderRequest).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    orderingMode: "DEFAULT",
    scheduledPickupAt: null,
  });
});
