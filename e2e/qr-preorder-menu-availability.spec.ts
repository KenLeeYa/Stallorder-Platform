import { expect, test } from "@playwright/test";

const firstPickupSlot = "2099-08-03T04:00:00.000Z";
const secondPickupSlot = "2099-08-03T05:00:00.000Z";
const slotBoundary = "2099-08-03T04:30:00.000Z";

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

test("PREORDER QR 依取餐時段更新商品與套餐選項並清除失效購物車", async ({ page }) => {
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
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        orderingMode: "PREORDER",
        preorderSlots: [firstPickupSlot, secondPickupSlot],
        // PREORDER must hide lottery UI even if an older session payload still enables it.
        lotteryEnabled: true,
        stall: {
          name: "預約時段測試攤位",
          slug: "preorder-availability-e2e",
          location: "測試夜市",
          currency: "TWD",
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

  await page.goto(`/q/preorder-availability-${Date.now()}`);

  await expect(page.getByRole("heading", { name: "預約時段測試攤位" })).toBeVisible();
  await expect(page.getByText("目前為非營業時間，僅接受預約外帶。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("預約取餐時間")).toHaveValue(firstPickupSlot);
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

  await page.getByLabel("預約取餐時間").selectOption(secondPickupSlot);

  await expect(page.getByRole("article").filter({ hasText: "早鳥飯糰" })).toHaveCount(0);
  await expect(page.getByRole("article").filter({ hasText: "晚場便當" })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).toHaveCount(0);
  await expect(bundle.getByRole("radio", { name: /晚場綠茶/ })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晚場綠茶/ })).not.toBeChecked();
  await expect(bundle).toContainText("$150");
  await expect(cart).toContainText("共 1 份");
  await expect(cart).toContainText("$150");
  await expect(page.getByRole("region", { name: "抽抽樂推薦" })).toHaveCount(0);

  await page.getByLabel("預約取餐時間").selectOption(firstPickupSlot);

  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).toBeVisible();
  await expect(bundle.getByRole("radio", { name: /晨間紅茶/ })).not.toBeChecked();
  await expect(cart).toContainText("共 1 份");
  await expect(cart).toContainText("$150");
});
