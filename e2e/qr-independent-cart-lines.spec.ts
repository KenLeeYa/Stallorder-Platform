import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectMobileSheetActionAvailable(
  page: Page,
  sheet: Locator,
  action: Locator,
) {
  await action.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await expect.poll(() => sheet.evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true);
  await expect.poll(() => action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + (rect.width / 2),
      rect.top + (rect.height / 2),
    );
    return {
      insideViewport: rect.left >= 0
        && rect.right <= window.innerWidth
        && rect.top >= 0
        && rect.bottom <= window.innerHeight,
      unobscured: target === element || element.contains(target),
    };
  })).toEqual({ insideViewport: true, unobscured: true });
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

test("QR 同商品可加入兩個不同註記列，報價低頻更新且返回頂端不遮住手機購物車", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.clock.install({ time: new Date("2099-08-03T01:00:00.000Z") });
  let availabilityRequests = 0;
  await page.route("**/api/availability/config", (route) => {
    availabilityRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(availableConfig),
    });
  });

  let sessionRequests = 0;
  let extendSessionOnReload = false;
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
          }, {
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd7",
            name: "加辣",
            priceDelta: 0,
            sortOrder: 2,
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
        expiresAt: requestBody.includeMenu !== false && extendSessionOnReload
          ? "2099-08-03T01:20:00.000Z"
          : "2099-08-03T01:10:00.000Z",
        orderingMode: "DEFAULT",
      }),
    });
  });

  await page.goto("/q/independent-lines-e2e-token");
  const product = page.getByRole("article").filter({ hasText: "測試雞排" });

  await product.getByRole("button", { name: "增加 測試雞排" }).click();
  const firstConfiguration = product.getByRole("dialog", { name: "測試雞排" });
  const addFirstLine = firstConfiguration.getByRole("button", { name: "加入購物車", exact: true });
  await expect(addFirstLine).toBeDisabled();
  await expect(firstConfiguration.getByRole("status")).toHaveText("請完成「測試雞排」的必選註記。");
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 500 });
    await expectMobileSheetActionAvailable(page, firstConfiguration, addFirstLine);
  }
  await product.getByRole("radio", { name: /加蛋/ }).check();
  await expect(addFirstLine).toBeEnabled();
  await addFirstLine.click();
  await expect(product).toContainText("購物車已有 1 份");
  await expect(product.getByText("本次再加", { exact: true })).toBeVisible();
  await product.getByRole("button", { name: "增加 測試雞排" }).click();
  await product.getByRole("radio", { name: /加起司/ }).check();
  const addSecondLine = product.getByRole("button", { name: "加入購物車" });
  await addSecondLine.click();

  const mobileSummary = page.getByTestId("qr-mobile-cart-summary");
  await expect(mobileSummary).toContainText("共 2 份");
  await mobileSummary.click();
  const cartPanel = page.getByTestId("qr-cart-panel");
  const continueToCheckout = cartPanel.getByRole("button", { name: "繼續填寫訂購資料", exact: true });
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 500 });
    await expectMobileSheetActionAvailable(page, cartPanel, continueToCheckout);
  }
  await expect(cartPanel.getByRole("button", { name: "關閉" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(continueToCheckout).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cartPanel).toBeHidden();
  await expect(mobileSummary).toBeFocused();
  await mobileSummary.click();
  const cartLines = page.getByTestId("qr-cart-line");
  await expect(cartLines).toHaveCount(2);
  await expect(cartLines.nth(0)).toContainText("加蛋");
  await expect(cartLines.nth(1)).toContainText("加起司");
  const firstLineId = await cartLines.nth(0).getAttribute("data-cart-line-id");
  await cartLines.nth(0).getByRole("button", { name: "修改客製" }).click();
  await expect(page.getByTestId("qr-cart-panel")).toBeHidden();
  await product.getByRole("radio", { name: /加辣/ }).check();
  const finishEditing = product.getByRole("button", { name: "修改完成", exact: true });
  await expect(finishEditing).toBeVisible();
  await expect.poll(() => finishEditing.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return target === element || element.contains(target);
  })).toBe(true);
  await finishEditing.click();
  await mobileSummary.click();
  await expect(cartLines).toHaveCount(2);
  await expect(cartLines.nth(0)).toHaveAttribute("data-cart-line-id", firstLineId!);
  await expect(cartLines.nth(0)).toContainText("加辣");
  await expect(cartLines.nth(0)).not.toContainText("加蛋");
  await page.getByTestId("qr-cart-panel").getByRole("button", { name: "關閉" }).click();

  await product.getByRole("button", { name: "增加 測試雞排" }).click();
  await product.getByRole("radio", { name: /加蛋/ }).check();
  await expect(product.getByRole("button", { name: "加入購物車", exact: true })).toBeVisible();
  await product.getByRole("dialog", { name: "測試雞排" }).getByRole("button", { name: "關閉" }).click();

  const backToTop = page.getByTestId("qr-back-to-top");
  await expect(backToTop).toBeVisible();
  const [backBox, summaryBox] = await Promise.all([backToTop.boundingBox(), mobileSummary.boundingBox()]);
  expect(backBox && summaryBox && backBox.y + backBox.height <= summaryBox.y).toBe(true);
  await mobileSummary.click();
  await expect(cartPanel).toHaveAttribute("aria-modal", "true");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.setViewportSize({ width: 900, height: 700 });
  const desktopCart = page.getByTestId("qr-cart-panel");
  await expect(desktopCart).toBeVisible();
  await expect(desktopCart).not.toHaveAttribute("aria-modal");
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  const [desktopBackBox, desktopCartBox] = await Promise.all([backToTop.boundingBox(), desktopCart.boundingBox()]);
  expect(desktopBackBox && desktopCartBox && desktopBackBox.x + desktopBackBox.width <= desktopCartBox.x).toBe(true);
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(mobileSummary).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await backToTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  const sessionStatus = page.getByTestId("qr-session-status");
  const sessionStatusBeforeHidden = await sessionStatus.textContent();
  const availabilityBeforeHidden = availabilityRequests;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(30_000);
  expect(availabilityRequests).toBe(availabilityBeforeHidden);
  await expect(sessionStatus).toHaveText(sessionStatusBeforeHidden ?? "");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => availabilityRequests).toBeGreaterThan(availabilityBeforeHidden);
  await expect(sessionStatus).not.toHaveText(sessionStatusBeforeHidden ?? "");

  await page.clock.fastForward(60_000);
  await expect.poll(() => sessionRequests).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("目前預估等候時間：12～18 分鐘", { exact: true })).toBeVisible();
  await mobileSummary.click();
  await page.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "訂購資料與確認", exact: true })).toBeFocused();
  await page.getByLabel("顧客稱呼").fill("獨立品項 QA");
  await page.getByLabel("聯絡電話").fill("0912345678");
  const waitAcknowledgement = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間為 12～18 分鐘/,
  });
  await expect(waitAcknowledgement).toBeVisible();
  await expect(waitAcknowledgement).not.toBeChecked();
  const checkoutBlocker = page.getByTestId("qr-checkout-blocker");
  const submitOrder = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(checkoutBlocker).toHaveAttribute("role", "status");
  await expect(checkoutBlocker).toHaveText("請先確認目前預估等候時間。");
  await expect(submitOrder).toBeDisabled();
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 500 });
    await expectMobileSheetActionAvailable(page, cartPanel, submitOrder);
  }
  await waitAcknowledgement.check();
  await expect(checkoutBlocker).toHaveCount(0);
  await expect(submitOrder).toBeEnabled();

  await page.clock.fastForward(8 * 60_000);
  const expiryDialog = page.getByRole("dialog", { name: "即將逾時" });
  await expect(expiryDialog).toBeVisible();
  await expect(expiryDialog).toHaveAttribute("aria-modal", "true");
  await expect(expiryDialog.getByRole("button", { name: "重新整理並繼續點餐" })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(expiryDialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.clock.fastForward(60_000);
  const expiredDialog = page.getByRole("dialog", { name: "已逾時" });
  await expect(expiredDialog).toBeVisible();
  await expect(checkoutBlocker).toHaveText("點餐工作階段已逾時，請重新掃描 QR Code。");
  await expect(cartPanel).toBeHidden();
  await expect(submitOrder).toHaveCount(0);
  expect(await page.evaluate((token) => {
    const stored = window.localStorage.getItem(`stallorder_qr_cart:${encodeURIComponent(token)}`);
    return stored ? JSON.parse(stored).lines.length : 0;
  }, "independent-lines-e2e-token")).toBe(2);

  extendSessionOnReload = true;
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("dialog", { name: "已逾時" }).getByRole("button", { name: "重新整理並繼續點餐" }).click(),
  ]);
  await expect(page.getByText("已恢復上次尚未送出的點餐內容。", { exact: true })).toBeVisible();
  await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("共 2 份");
  await expect(product.getByRole("button", { name: "加入購物車", exact: true })).toHaveCount(0);
});
