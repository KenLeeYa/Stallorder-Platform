import { expect, test, type Browser, type Page } from "@playwright/test";

const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const trackingToken = `sto_${"t".repeat(48)}`;
const qrToken = "reorder-e2e-qr-token-that-is-long-enough";
const productId = "77777777-7777-4777-8777-777777777771";

test.describe("LINE 通知與再次點餐", () => {
  test("商家可開啟 LINE 設定，KITCHEN 無管理權限", async ({ page, browser }) => {
    await login(page, "owner@stallorder.test", /\/merchant\/dashboard/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/merchant/stalls/${stallId}/line`);
    await expect(page.getByRole("heading", { name: "LINE 訂單通知" })).toBeVisible();
    await expect(page.getByLabel("LINE Login Channel ID")).toBeVisible();
    await expect(page.getByLabel("Messaging API Channel Access Token")).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Messaging API Channel Secret")).toHaveAttribute("type", "password");
    await expect(page.getByLabel("LINE Login Channel Secret")).toHaveAttribute("type", "password");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const kitchenPage = await newRolePage(browser, "kitchen@stallorder.test", /\/kitchen/);
    const responseStatus = await kitchenPage.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      return response.status;
    }, `/api/merchant/stalls/${stallId}/line`);
    expect(responseStatus).toBe(403);
    await kitchenPage.context().close();
  });

  test("訂單追蹤可顯示 LINE 控制，並以目前價格重建新的 QR 購物車", async ({ page }) => {
    await mockPublicFunctions(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/order/${trackingToken}`);
    await expect(page.getByRole("heading", { name: "測試攤位" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 LINE 接收通知" })).toBeVisible();
    await page.getByRole("link", { name: "再次點餐" }).click();

    await expect(page.getByRole("heading", { name: "再次點餐" })).toBeVisible();
    await expect(page.getByText("2 × 現在雞排")).toBeVisible();
    await expect(page.getByText("原 $100", { exact: true })).toBeVisible();
    await expect(page.getByText("$115", { exact: true })).toBeVisible();
    await expect(page.getByText("舊版飲料")).toBeVisible();
    await expect(page.getByText("目前售罄")).toBeVisible();

    await page.getByRole("button", { name: "前往目前菜單確認" }).click();
    await expect(page).toHaveURL(new RegExp(`/q/${qrToken}$`));
    await expect(page.getByText("已恢復上次尚未送出的點餐內容。")).toBeVisible();
    const product = page.getByRole("article").filter({ hasText: "現在雞排" });
    await expect(product.getByText("2", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

async function mockPublicFunctions(page: Page) {
  await page.route(/\/functions\/v1\/get-public-order$|\/api\/public-order\/get-public-order$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        order: {
          orderNo: "E2E-LINE-001",
          orderStatus: "READY",
          paymentStatus: "UNPAID",
          totalAmount: 200,
          createdAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          completedAt: null,
          stallName: "測試攤位",
          pickupVerificationCode: "321",
          fulfillmentType: "TAKEOUT",
          tableLabel: null,
          customerPhone: null,
          deliveryAddress: null,
          estimatedWaitMinutes: 10,
          quotedWaitMinutes: 10,
          quotedReadyAt: null,
          lastTableOrderAt: null,
          items: [{ id: "item-1", name: "舊版雞排", quantity: 2, note: null, noteOptions: [], status: "READY" }],
        },
      }),
    });
  });
  await page.route(/\/functions\/v1\/manage-line-link$|\/api\/public-order\/manage-line-link$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        linked: false,
        displayName: "LINE 取餐通知",
        officialAccountUrl: "",
        repeatOrderAvailable: true,
      }),
    });
  });
  await page.route(/\/functions\/v1\/prepare-reorder$|\/api\/public-order\/prepare-reorder$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        qrToken,
        orderingMode: "DEFAULT",
        orderPath: `/q/${qrToken}`,
        availableItems: [{
          productId,
          name: "現在雞排",
          quantity: 2,
          noteOptionIds: [],
          previousUnitPrice: 100,
          currentUnitPrice: 115,
          priceChanged: true,
          needsReview: false,
        }],
        unavailableItems: [{ name: "舊版飲料", reason: "目前售罄" }],
      }),
    });
  });
  await page.route(/\/functions\/v1\/create-order-session$|\/api\/public-order\/create-order-session$/, async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        orderSessionToken: `session_${"s".repeat(48)}`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        stall: { name: "測試攤位", slug: "test-stall", location: "台北", currency: "TWD", fulfillmentType: "TAKEOUT", table: null },
        products: [{ id: productId, name: "現在雞排", description: "重新核價商品", price: 115, category: "主餐", imageUrl: null, translations: [], noteGroups: [] }],
        supportedLocales: ["zh-TW"],
        estimatedWaitMinutes: 10,
        estimatedWaitMinMinutes: 10,
        estimatedWaitMaxMinutes: 10,
        waitAcknowledgmentThresholdMinutes: null,
        requiresWaitAcknowledgment: false,
        lastTableOrderAt: null,
        limits: { maxItemQuantity: 20, maxUniqueProducts: 20, maxTotalQuantity: 40, maxNoteLength: 200 },
      }),
    });
  });
}

async function newRolePage(browser: Browser, email: string, destination: RegExp) {
  const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const page = await context.newPage();
  await login(page, email, destination);
  return page;
}

async function login(page: Page, email: string, destination: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL(destination, { timeout: 30_000 });
}
