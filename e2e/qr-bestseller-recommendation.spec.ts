import { expect, test } from "@playwright/test";

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
  updatedAt: "2026-08-02T00:00:00.000Z",
};

const product = (
  id: string,
  name: string,
  category: string,
  rank: number | null,
) => ({
  id,
  name,
  description: `${name} 說明`,
  price: 100,
  category,
  rank,
  isBestSeller: rank !== null,
  imageUrl: null,
  translations: [],
  noteGroups: [],
});

test("QR 菜單在原分類內優先顯示熱銷推薦", async ({ page }) => {
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
        orderSessionToken: `stos_${"a".repeat(43)}`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        stall: {
          name: "熱銷測試攤位",
          slug: "bestseller-e2e",
          location: "測試地點",
          currency: "TWD",
          fulfillmentType: "TAKEOUT",
          table: null,
        },
        products: [
          product("meal-best", "熱銷主餐", "主餐", 2),
          product("meal-regular", "一般主餐", "主餐", null),
          product("drink-best", "熱銷飲品", "飲品", 1),
          product("drink-regular", "一般飲品", "飲品", null),
        ],
        supportedLocales: ["zh-TW"],
        estimatedWaitMinutes: 10,
        estimatedWaitMinMinutes: 8,
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

  await page.goto(`/q/bestseller-e2e-${Date.now()}`);

  await expect(page.getByRole("heading", { name: "熱銷測試攤位" })).toBeVisible();
  const articles = page.getByRole("article");
  await expect(articles).toHaveCount(4);
  await expect(articles.nth(0)).toContainText("熱銷主餐");
  await expect(articles.nth(1)).toContainText("一般主餐");
  await expect(articles.nth(2)).toContainText("熱銷飲品");
  await expect(articles.nth(3)).toContainText("一般飲品");
  await expect(page.getByTestId("best-seller-badge")).toHaveCount(2);
  await expect(articles.nth(0)).toContainText("熱銷推薦");
  await expect(articles.nth(2)).toContainText("熱銷推薦");
  await expect(articles.nth(0)).toHaveAttribute("data-best-seller-rank", "2");
  await expect(articles.nth(2)).toHaveAttribute("data-best-seller-rank", "1");
});
