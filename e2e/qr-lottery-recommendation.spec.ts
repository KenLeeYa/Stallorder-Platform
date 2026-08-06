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
  updatedAt: "2099-08-03T00:00:00.000Z",
};

test("QR 抽抽樂說明熱銷加權依據、顯示名次與折扣，並將推薦商品加入購物車", async ({ page }) => {
  let lotteryRequestCount = 0;
  const lotteryRequestBodies: Array<{ deviceId?: string }> = [];
  await page.route("**/api/availability/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(availableConfig),
  }));
  await page.route("**/create-order-session", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({
      orderSessionToken: `stos_${"a".repeat(43)}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      orderingMode: "DEFAULT",
      stall: {
        name: "抽抽樂測試攤位",
        slug: "lottery-e2e",
        location: "測試地點",
        currency: "TWD",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [{
        id: "33333333-3333-4333-8333-333333333333",
        name: "招牌餐點",
        description: "由抽抽樂推薦",
        price: 120,
        kind: "SINGLE",
        category: "主餐",
        rank: 1,
        isBestSeller: true,
        imageUrl: null,
        translations: [],
        noteGroups: [],
        bundleChoiceGroups: [],
      }],
      supportedLocales: ["zh-TW"],
      preorderSlots: [],
      lotteryEnabled: true,
      estimatedWaitMinutes: 13,
      estimatedWaitMinMinutes: 13,
      estimatedWaitMaxMinutes: 18,
      waitAcknowledgmentThresholdMinutes: 30,
      requiresWaitAcknowledgment: false,
      lastTableOrderAt: null,
      limits: {
        maxItemQuantity: 20,
        maxUniqueProducts: 20,
        maxTotalQuantity: 50,
        maxNoteLength: 300,
      },
    }),
  }));

  await page.route("**/api/public/lottery-draw", async (route) => {
    lotteryRequestCount += 1;
    lotteryRequestBodies.push(route.request().postDataJSON() as { deviceId?: string });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        drawId: "22222222-2222-4222-8222-222222222222",
        productId: "33333333-3333-4333-8333-333333333333",
        productName: "招牌餐點",
        bestSellerRank: 1,
        recommendationBasis: "BEST_SELLER",
        recommendationStrategy: "POPULARITY_30D",
        discountWon: true,
        discountLabel: "抽抽樂九折",
        idempotentReplay: lotteryRequestCount > 1,
      }),
    });
  });

  await page.goto("/q/lottery-e2e-token-20260803");
  const lottery = page.getByRole("region", { name: "抽抽樂推薦" });
  const dailyLimitDialog = page.getByRole("alertdialog", {
    name: "此瀏覽器今日已抽取過",
  });
  await expect(lottery).toBeVisible();
  await expect(lottery).toContainText("依近 30 天完成訂單的熱銷趨勢推薦");
  const drawRequest = page.waitForRequest((request) => (
    new URL(request.url()).pathname === "/api/public/lottery-draw"
    && request.method() === "POST"
  ));
  await lottery.getByRole("button", { name: "開始抽抽樂" }).click();

  await expect(lottery.getByRole("status")).toHaveText("推薦你點「招牌餐點」，並抽中 抽抽樂九折！");
  await expect(lottery.getByTestId("lottery-recommendation-basis"))
    .toHaveText("近 30 天熱銷第 1 名");
  await expect(dailyLimitDialog).toHaveCount(0);
  const drawBody = (await drawRequest).postDataJSON() as {
    orderSessionToken?: string;
    deviceId?: string;
  };
  expect(drawBody.orderSessionToken).toBe(`stos_${"a".repeat(43)}`);
  expect(drawBody.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("共 1 份");

  const resultButton = lottery.getByRole("button", { name: "查看今日結果" });
  await resultButton.click();
  await expect(dailyLimitDialog).toBeVisible();
  await expect(dailyLimitDialog).toContainText("今天的商品推薦與折扣結果已保留");
  await expect(dailyLimitDialog.getByRole("button", { name: "我知道了" })).toBeFocused();
  expect(lotteryRequestCount).toBe(1);
  await dailyLimitDialog.getByRole("button", { name: "我知道了" }).click();
  await expect(dailyLimitDialog).toHaveCount(0);
  await expect(lottery.getByRole("status")).toHaveText("推薦你點「招牌餐點」，並抽中 抽抽樂九折！");

  await page.reload();
  const reloadedLottery = page.getByRole("region", { name: "抽抽樂推薦" });
  const replayButton = reloadedLottery.getByRole("button", { name: "開始抽抽樂" });
  await replayButton.click();
  await expect(dailyLimitDialog).toBeVisible();
  expect(lotteryRequestCount).toBe(2);
  expect(lotteryRequestBodies[1]?.deviceId).toBe(drawBody.deviceId);
  await expect(reloadedLottery.getByRole("status")).toHaveText("推薦你點「招牌餐點」，並抽中 抽抽樂九折！");
  await expect(reloadedLottery.getByTestId("lottery-recommendation-basis"))
    .toHaveText("近 30 天熱銷第 1 名");
  await page.keyboard.press("Escape");
  await expect(dailyLimitDialog).toHaveCount(0);
  await expect(reloadedLottery.getByRole("button", { name: "查看今日結果" })).toBeFocused();
  await expect(reloadedLottery.getByRole("status")).toHaveText("推薦你點「招牌餐點」，並抽中 抽抽樂九折！");
});
