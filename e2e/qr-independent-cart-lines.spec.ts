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

test("QR 同商品可加入兩個不同註記列，報價低頻更新且返回頂端不遮住手機購物車", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.clock.install({ time: new Date("2099-08-03T01:00:00.000Z") });
  await page.route("**/api/availability/config", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(availableConfig),
  }));

  let sessionRequests = 0;
  await page.route("**/create-order-session", async (route) => {
    sessionRequests += 1;
    const requestBody = route.request().postDataJSON() as { includeMenu?: boolean };
    const capacity = sessionRequests === 1
      ? {
          estimatedWaitMinutes: 10,
          estimatedWaitMinMinutes: 5,
          estimatedWaitMaxMinutes: 10,
          waitAcknowledgmentThresholdMinutes: 15,
          requiresWaitAcknowledgment: false,
        }
      : {
          estimatedWaitMinutes: 18,
          estimatedWaitMinMinutes: 12,
          estimatedWaitMaxMinutes: 18,
          waitAcknowledgmentThresholdMinutes: 15,
          requiresWaitAcknowledgment: true,
        };
    const menu = requestBody.includeMenu === false ? {} : {
      stall: {
        name: "獨立品項測試攤位",
        slug: "independent-lines-e2e",
        location: "測試夜市",
        currency: "TWD",
        fulfillmentType: "TAKEOUT",
        table: null,
      },
      products: [{
        id: "44444444-4444-4444-8444-444444444441",
        name: "測試雞排",
        description: "可分別選擇註記",
        price: 95,
        kind: "SINGLE",
        category: "炸物",
        rank: null,
        isBestSeller: false,
        imageUrl: null,
        translations: [],
        bundleChoiceGroups: [],
        noteGroups: [{
          id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
          name: "加料",
          selectionMode: "SINGLE",
          isRequired: true,
          minSelections: 1,
          maxSelections: 1,
          sortOrder: 0,
          translations: [],
          options: [{
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd5",
            name: "加蛋",
            priceDelta: 15,
            sortOrder: 0,
            translations: [],
          }, {
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd6",
            name: "加起司",
            priceDelta: 20,
            sortOrder: 1,
            translations: [],
          }],
        }],
      }],
      supportedLocales: ["zh-TW"],
      preorderSlots: [],
      lotteryEnabled: false,
      lastTableOrderAt: null,
      limits: {
        maxItemQuantity: 5,
        maxUniqueProducts: 5,
        maxTotalQuantity: 10,
        maxNoteLength: 300,
      },
    };
    await route.fulfill({
      status: sessionRequests === 1 ? 201 : 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        ...menu,
        ...capacity,
        orderSessionToken: `stos_${"l".repeat(43)}`,
        expiresAt: "2099-08-03T01:10:00.000Z",
        orderingMode: "DEFAULT",
      }),
    });
  });

  await page.goto("/q/independent-lines-e2e-token");
  const product = page.getByRole("article").filter({ hasText: "測試雞排" });

  await product.getByRole("button", { name: "增加 測試雞排" }).click();
  await product.getByRole("radio", { name: /加蛋/ }).check();
  await product.getByRole("button", { name: "加入購物車" }).click();
  await product.getByRole("button", { name: "增加 測試雞排" }).click();
  await product.getByRole("radio", { name: /加起司/ }).check();
  await product.getByRole("button", { name: "加入購物車" }).click();

  const mobileSummary = page.getByTestId("qr-mobile-cart-summary");
  await expect(mobileSummary).toContainText("共 2 份");
  await mobileSummary.click();
  const cartLines = page.getByTestId("qr-cart-line");
  await expect(cartLines).toHaveCount(2);
  await expect(cartLines.nth(0)).toContainText("加蛋");
  await expect(cartLines.nth(1)).toContainText("加起司");
  await page.getByTestId("qr-cart-panel").getByRole("button", { name: "關閉" }).click();

  const backToTop = page.getByTestId("qr-back-to-top");
  await expect(backToTop).toBeVisible();
  const [backBox, summaryBox] = await Promise.all([backToTop.boundingBox(), mobileSummary.boundingBox()]);
  expect(backBox && summaryBox && backBox.y + backBox.height <= summaryBox.y).toBe(true);
  await page.setViewportSize({ width: 900, height: 700 });
  const desktopCart = page.getByTestId("qr-cart-panel");
  await expect(desktopCart).toBeVisible();
  const [desktopBackBox, desktopCartBox] = await Promise.all([backToTop.boundingBox(), desktopCart.boundingBox()]);
  expect(desktopBackBox && desktopCartBox && desktopBackBox.x + desktopBackBox.width <= desktopCartBox.x).toBe(true);
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(mobileSummary).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await backToTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.clock.fastForward(60_000);
  await expect.poll(() => sessionRequests).toBe(2);
  await expect(page.getByText("目前預估等候時間：12～18 分鐘", { exact: true })).toBeVisible();
  await mobileSummary.click();
  const waitAcknowledgement = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間為 12～18 分鐘/,
  });
  await expect(waitAcknowledgement).toBeVisible();
  await expect(waitAcknowledgement).not.toBeChecked();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeDisabled();
});
