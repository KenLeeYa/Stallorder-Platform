import { expect, test, type Browser, type Page } from "@playwright/test";
import { gotoLocalPath } from "./local-navigation";

const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const trackingToken = `sto_${"t".repeat(48)}`;
test.describe("LINE 通知與 Menu 返回", () => {
  test("商家可開啟 LINE 設定，KITCHEN 無管理權限", async ({ page, browser }) => {
    await login(page, "owner@stallorder.test", /\/merchant\/dashboard\?organizationId=/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/merchant/stalls/${stallId}/line`);
    await expect(page.getByRole("heading", { name: "LINE 訂單通知" })).toBeVisible();
    await expect(page.getByLabel("LINE Login Channel ID")).toBeVisible();
    await expect(page.getByLabel("Messaging API Channel Access Token")).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Messaging API Channel Secret")).toHaveAttribute("type", "password");
    await expect(page.getByLabel("LINE Login Channel Secret")).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Messaging API Channel Access Token")).toHaveAttribute("minlength", "16");

    const channelIdField = page.getByLabel("LINE Login Channel ID");
    await channelIdField.fill("中文代碼");
    const invalidChannelResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/merchant/stalls/${stallId}/line`)
      && response.request().method() === "PATCH"
    ));
    await page.getByRole("button", { name: "儲存並輪替憑證" }).click();
    expect((await invalidChannelResponse).status()).toBe(400);
    await expect(page.getByText("LINE Login Channel ID 格式不正確。", { exact: true }).first()).toBeVisible();
    await expect(channelIdField).toHaveAttribute("aria-invalid", "true");
    await expect(channelIdField).toBeFocused();
    await expect(channelIdField).toHaveValue("中文代碼");

    await channelIdField.fill("");
    const blankChannelResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/merchant/stalls/${stallId}/line`)
      && response.request().method() === "PATCH"
    ));
    await page.getByRole("button", { name: "儲存並輪替憑證" }).click();
    expect((await blankChannelResponse).status()).toBe(400);
    await expect(channelIdField).toHaveAttribute("aria-invalid", "true");
    await expect(channelIdField).toBeFocused();
    await expect(channelIdField).toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const kitchenPage = await newRolePage(browser, "kitchen@stallorder.test", /\/kitchen/);
    const responseStatus = await kitchenPage.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      return response.status;
    }, `/api/merchant/stalls/${stallId}/line`);
    expect(responseStatus).toBe(403);
    await kitchenPage.context().close();
  });

  test("訂單追蹤可顯示 LINE 控制，並以無快取網址返回目前 Menu", async ({ page }) => {
    await mockPublicFunctions(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const trackerPath = `/order/${trackingToken}`;
    await gotoLocalPath(page, trackerPath);
    await expect(page.getByRole("heading", { name: "測試攤位" })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用 LINE 接收通知" })).toBeVisible();
    const pickupReadyDialog = page.getByRole("dialog", { name: "餐點已可取餐" });
    await expect(pickupReadyDialog.getByTestId("pickup-ready-dialog-code")).toHaveText("321");
    await pickupReadyDialog.getByRole("button", { name: "我知道了" }).last().click();
    await expect(pickupReadyDialog).toBeHidden();
    await page.getByRole("button", { name: "返回 Menu", exact: true }).click();
    await expect(page).toHaveURL(/\/store\/aming-01\?fresh=\d+$/u);
    await expect(page.getByRole("main")).toBeVisible();
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
          publicMenuIdentifier: "aming-01",
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
