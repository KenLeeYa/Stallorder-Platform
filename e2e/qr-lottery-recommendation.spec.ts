import { expect, test, type Locator, type Page } from "@playwright/test";

const SIMPLE_PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const CONFIGURABLE_PRODUCT_ID = "44444444-4444-4444-8444-444444444444";

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

test("QR 抽抽樂先顯示動畫與結果視窗，取消不改購物車且不能再次抽取", async ({ page }) => {
  const lottery = await mockLottery(page, SIMPLE_PRODUCT_ID);

  const resultDialog = await drawAndWaitForResult(page, lottery.region);
  await expect(resultDialog).toContainText("推薦你點「招牌餐點」");
  await expect(resultDialog.getByTestId("lottery-result-basis")).toHaveText("熱銷推薦");
  await expect(resultDialog.getByTestId("lottery-discount-result")).toHaveText("同時抽中 抽抽樂九折！");
  await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);

  const acceptButton = resultDialog.getByRole("button", { name: "接受推薦", exact: true });
  const cancelButton = resultDialog.getByRole("button", { name: "取消", exact: true });
  await expect(acceptButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(acceptButton).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(resultDialog).toHaveCount(0);
  await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
  await expect(lottery.region.getByRole("button", { name: "今日已抽取", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

  const dailyLimitTrigger = lottery.region.getByRole("button", { name: "今日已抽取", exact: true });
  await dailyLimitTrigger.click();
  const dailyLimitDialog = page.getByRole("alertdialog", { name: "此瀏覽器今日已抽取過" });
  await expect(dailyLimitDialog).toBeVisible();
  await expect(dailyLimitDialog).toContainText("今天的商品推薦與折扣結果已保留");
  const acknowledgeDailyLimit = dailyLimitDialog.getByRole("button", { name: "我知道了", exact: true });
  await expect(acknowledgeDailyLimit).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Tab");
  await expect(acknowledgeDailyLimit).toBeFocused();
  expect(lottery.requestCount()).toBe(1);
  await acknowledgeDailyLimit.click();
  await expect(dailyLimitDialog).toHaveCount(0);
  await expect(dailyLimitTrigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

  await dailyLimitTrigger.click();
  await expect(dailyLimitDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dailyLimitDialog).toHaveCount(0);
  await expect(dailyLimitTrigger).toBeFocused();

  await page.reload();
  const reloadedLottery = page.getByRole("region", { name: "抽抽樂推薦" });
  await reloadedLottery.getByRole("button", { name: "開始抽抽樂", exact: true }).click();
  await expect(dailyLimitDialog).toBeVisible({ timeout: 2_500 });
  await expect(page.getByTestId("lottery-result-dialog")).toHaveCount(0);
  await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
  expect(lottery.requestCount()).toBe(2);
});

test("reduced-motion 停止抽獎輪播與 CSS 動畫，回應完成後立即顯示結果", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  const lottery = await mockLottery(page, SIMPLE_PRODUCT_ID, 20, 10 * 60_000, {
    holdFirstDraw: true,
  });

  await lottery.region.getByRole("button", { name: "開始抽抽樂", exact: true }).click();
  const resultDialog = page.getByTestId("lottery-result-dialog");
  await expect(resultDialog).toHaveAttribute("data-phase", "drawing");
  const carousel = resultDialog.getByTestId("lottery-product-carousel");
  const initialProductName = await carousel.textContent();

  await page.clock.fastForward(1_000);
  await expect(carousel).toHaveText(initialProductName ?? "");
  expect(await carousel.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await resultDialog.locator("svg").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

  lottery.releaseDraw();
  await expect(resultDialog).toHaveAttribute("data-phase", "result", { timeout: 1_000 });
});

for (const failureMode of ["HTTP_503", "NETWORK"] as const) {
  test(`抽獎 ${failureMode} 失敗後顯示可見錯誤、恢復焦點並可重試成功`, async ({ page }) => {
    const lottery = await mockLottery(page, SIMPLE_PRODUCT_ID, 20, 10 * 60_000, {
      firstDrawFailure: failureMode,
    });
    const drawButton = lottery.region.getByRole("button", { name: "開始抽抽樂", exact: true });

    await drawButton.click();
    await expect(page.getByTestId("lottery-result-dialog")).toHaveCount(0);
    await expect(lottery.region.getByRole("alert")).toHaveText("抽抽樂目前無法使用。");
    await expect(drawButton).toBeEnabled();
    await expect(drawButton).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

    const resultDialog = await drawAndWaitForResult(page, lottery.region);
    await expect(resultDialog).toContainText("推薦你點「招牌餐點」");
    expect(lottery.requestCount()).toBe(2);
  });
}

test("抽取結果顯示後即將逾時會先保留結果，關閉後由逾時視窗接管", async ({ page }) => {
  await page.clock.install();
  const lottery = await mockLottery(page, SIMPLE_PRODUCT_ID, 20, 2 * 60_000);

  await lottery.region.getByRole("button", { name: "開始抽抽樂", exact: true }).click();
  const resultDialog = page.getByTestId("lottery-result-dialog");
  await expect(resultDialog).toHaveAttribute("data-phase", "drawing");
  await expect(resultDialog).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.clock.fastForward(3_000);
  await expect(resultDialog).toHaveAttribute("data-phase", "result");

  await page.clock.fastForward(60_000);
  const expiryDialog = page.getByTestId("qr-session-expiry-dialog");
  await expect(resultDialog).toBeVisible();
  await expect(expiryDialog).toHaveCount(0);
  await expect(page.getByRole("alertdialog", { name: "此瀏覽器今日已抽取過" })).toHaveCount(0);

  await resultDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(expiryDialog).toBeVisible();
  await expect(resultDialog).toHaveCount(0);
  const refreshButton = expiryDialog.getByRole("button", { name: "重新整理並繼續點餐" });
  await expect(refreshButton).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(expiryDialog).toBeVisible();
  await expect(refreshButton).toBeFocused();
});

test("接受一般商品推薦後直接加入一份購物車", async ({ page }) => {
  const lottery = await mockLottery(page, SIMPLE_PRODUCT_ID);

  const resultDialog = await drawAndWaitForResult(page, lottery.region);
  await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
  await resultDialog.getByRole("button", { name: "接受推薦", exact: true }).click();

  await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("共 1 份");
  await expect(lottery.region.getByRole("button", { name: "今日已抽取", exact: true })).toBeFocused();
  expect(lottery.requestCount()).toBe(1);
});

test("接受需客製商品推薦後開啟規格視窗，但不先加入購物車", async ({ page }) => {
  const lottery = await mockLottery(page, CONFIGURABLE_PRODUCT_ID);

  const resultDialog = await drawAndWaitForResult(page, lottery.region);
  await resultDialog.getByRole("button", { name: "接受推薦", exact: true }).click();

  const product = page.getByRole("article").filter({ hasText: "客製雞排" });
  const configuration = product.getByRole("dialog", { name: "客製雞排" });
  await expect(configuration).toBeVisible();
  await expect(configuration).toBeFocused();
  await expect(configuration.getByRole("radio", { name: /加蛋/ })).toBeVisible();
  await expect(configuration.getByRole("button", { name: "加入購物車", exact: true })).toBeVisible();
  await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
  expect(lottery.requestCount()).toBe(1);
});

test("接受一般商品推薦仍受商品數量上限限制", async ({ page }) => {
  const lottery = await mockLottery(page, SIMPLE_PRODUCT_ID, 1);
  const product = page.getByRole("article").filter({ hasText: "招牌餐點" });
  await product.getByRole("button", { name: "增加 招牌餐點", exact: true }).click();
  await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("共 1 份");

  const resultDialog = await drawAndWaitForResult(page, lottery.region);
  await resultDialog.getByRole("button", { name: "接受推薦", exact: true }).click();

  await expect(resultDialog).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "已達本攤位的點餐數量限制" })).toBeVisible();
  await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("共 1 份");
});

async function drawAndWaitForResult(page: Page, lotteryRegion: Locator) {
  await lotteryRegion.getByRole("button", { name: "開始抽抽樂", exact: true }).click();
  const resultDialog = page.getByTestId("lottery-result-dialog");
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog).toHaveAttribute("data-phase", "drawing");
  await expect(resultDialog.getByTestId("lottery-product-carousel")).toBeVisible();
  await expect(resultDialog).toHaveAttribute("data-phase", "result", { timeout: 2_500 });
  return resultDialog;
}

async function mockLottery(
  page: Page,
  recommendedProductId: string,
  maxItemQuantity = 20,
  expiresInMs = 10 * 60_000,
  options: {
    firstDrawFailure?: "HTTP_503" | "NETWORK";
    holdFirstDraw?: boolean;
  } = {},
) {
  let requestCount = 0;
  let successfulDrawCount = 0;
  let releaseFirstDraw: () => void = () => undefined;
  const firstDrawReleased = new Promise<void>((resolve) => {
    releaseFirstDraw = resolve;
  });
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
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      orderingMode: "DEFAULT",
      stall: {
        name: "抽抽樂測試攤位",
        slug: "lottery-e2e",
        location: "測試地點",
        currency: "TWD",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [simpleProduct(), configurableProduct()],
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
        maxItemQuantity,
        maxUniqueProducts: 20,
        maxTotalQuantity: 50,
        maxNoteLength: 300,
      },
    }),
  }));
  await page.route("**/api/public/lottery-draw", async (route) => {
    requestCount += 1;
    if (requestCount === 1 && options.holdFirstDraw) await firstDrawReleased;
    if (requestCount === 1 && options.firstDrawFailure === "HTTP_503") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "不應顯示的伺服器錯誤細節",
          code: "LOTTERY_UNAVAILABLE",
        }),
      });
    }
    if (requestCount === 1 && options.firstDrawFailure === "NETWORK") {
      return route.abort("failed");
    }
    successfulDrawCount += 1;
    const recommendedProduct = recommendedProductId === SIMPLE_PRODUCT_ID
      ? simpleProduct()
      : configurableProduct();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        drawId: "22222222-2222-4222-8222-222222222222",
        productId: recommendedProduct.id,
        productName: recommendedProduct.name,
        bestSellerRank: recommendedProduct.rank,
        recommendationBasis: recommendedProduct.isBestSeller ? "BEST_SELLER" : "DISCOVERY",
        recommendationStrategy: "POPULARITY_30D",
        discountWon: true,
        discountLabel: "抽抽樂九折",
        idempotentReplay: successfulDrawCount > 1,
      }),
    });
  });

  await page.goto(`/q/lottery-e2e-${recommendedProductId}`);
  const region = page.getByRole("region", { name: "抽抽樂推薦" });
  await expect(region).toBeVisible();
  return {
    region,
    requestCount: () => requestCount,
    releaseDraw: releaseFirstDraw,
  };
}

function simpleProduct() {
  return {
    id: SIMPLE_PRODUCT_ID,
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
  };
}

function configurableProduct() {
  return {
    id: CONFIGURABLE_PRODUCT_ID,
    name: "客製雞排",
    description: "需選擇加料",
    price: 95,
    kind: "SINGLE",
    category: "主餐",
    rank: null,
    isBestSeller: false,
    imageUrl: null,
    translations: [],
    bundleChoiceGroups: [],
    noteGroups: [{
      id: "55555555-5555-4555-8555-555555555555",
      name: "加料",
      selectionMode: "SINGLE",
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 0,
      translations: [],
      options: [{
        id: "66666666-6666-4666-8666-666666666666",
        name: "加蛋",
        priceDelta: 15,
        sortOrder: 0,
        translations: [],
      }],
    }],
  };
}
