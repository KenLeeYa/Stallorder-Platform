import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { addFirstStaffCatalogProduct, dismissStaffStartReminder, loginLocalTestAccount } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let checkoutOrderId = "";
let checkoutOrderNo = "";
let paymentsUiOverrideId = "";

test.use({ serviceWorkers: "block", trace: "off", video: "off" });
test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(database.hostname)
    || database.port !== (process.env.CI ? "54322" : "55722")) throw new Error("LOCAL_QA_DATABASE_REQUIRED");
  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId, stallProducts: { some: { stallId, isEnabled: true } } },
    select: { id: true, name: true },
  });
  const order = await prisma.order.create({ data: {
    organizationId, stallId, orderNo: `QA-CASH-${randomUUID().slice(0, 8)}`,
    trackingTokenHash: randomBytes(32).toString("hex"), idempotencyKey: randomUUID(),
    deviceHash: "checkout-controls-local-qa", customerName: "結帳版面測試",
    source: "QR_MENU", isTest: true, fulfillmentType: "TAKEOUT", status: "READY",
    paymentStatus: "UNPAID", subtotal: 95, total: 95,
    confirmationExpiresAt: new Date(Date.now() + 30 * 60_000),
    items: { create: { organizationId, stallId, productId: product.id, name: product.name,
      baseUnitPrice: 95, unitPrice: 95, quantity: 1, status: "READY" } },
  } });
  checkoutOrderId = order.id;
  checkoutOrderNo = order.orderNo;
  const flag = await prisma.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "PAYMENTS_ADMIN_UI_ENABLED" }, select: { id: true } });
  paymentsUiOverrideId = (await prisma.resilienceFeatureFlagOverride.create({ data: {
    flagId: flag.id, scopeType: "GLOBAL", enabled: true,
    reason: "Isolated payment channel accessibility regression",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  } })).id;
});
test.afterAll(async () => {
  try {
    if (paymentsUiOverrideId) await prisma.resilienceFeatureFlagOverride.deleteMany({ where: { id: paymentsUiOverrideId } });
    if (checkoutOrderId) await prisma.order.deleteMany({ where: { id: checkoutOrderId } });
  } finally { await prisma.$disconnect(); }
});
test.beforeEach(async ({ page }) => {
  const app = new URL(process.env.PLAYWRIGHT_APP_URL ?? "http://invalid");
  if (!["127.0.0.1", "localhost"].includes(app.hostname)) throw new Error("LOCAL_QA_ONLY");
  await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
  await expect(page).toHaveURL(/\/merchant\//);
});

for (const width of [320, 390, 768, 1440]) test(`點餐即時總額與醒目找零 ${width}px`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await page.getByRole("button", { name: "店員點餐", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "店員點餐", exact: true });
  await addFirstStaffCatalogProduct(page, composer);
  if (width < 768) await composer.getByTestId("staff-order-cart-tab").click();
  const total = composer.getByTestId("staff-cart-live-total");
  await expect(total).toContainText("1 份");
  const firstAmount = Number((await total.locator("strong").innerText()).replace(/[^0-9.]/g, ""));
  expect(firstAmount).toBeGreaterThan(0);
  await composer.getByTestId("staff-order-cart-panel").getByRole("button", { name: /^增加 / }).click();
  await expect(total).toContainText("2 份");
  await expect(total.locator("strong")).toHaveText(`$${firstAmount * 2}`);
  expect(await composer.getByTestId("staff-cart-line").locator("strong").evaluate(el => getComputedStyle(el).whiteSpace)).toBe("nowrap");
  await page.screenshot({ path: info.outputPath(`cart-${width}.png`), caret: "initial" });
  await composer.getByTestId("staff-tablet-confirm-order").click();
  const cash = composer.getByTestId("staff-cash-received-field").getByRole("textbox");
  const change = composer.getByTestId("cash-change-summary");
  const quick = composer.getByTestId("cash-quick-amounts");
  const discount = composer.getByTestId("staff-discount-trigger");
  async function expectCashButtonsBesideDiscount() {
    await discount.scrollIntoViewIfNeeded();
    const discountBox = (await discount.boundingBox())!;
    const quickBox = (await quick.boundingBox())!;
    expect(quickBox.x).toBeGreaterThanOrEqual(discountBox.x + discountBox.width);
    expect(Math.abs(quickBox.y + quickBox.height / 2 - discountBox.y - discountBox.height / 2)).toBeLessThan(2);
    const inputBox = (await cash.boundingBox())!;
    expect(inputBox.x).toBeGreaterThanOrEqual(quickBox.x + quickBox.width);
    expect(Math.abs(inputBox.y + inputBox.height / 2 - discountBox.y - discountBox.height / 2)).toBeLessThan(2);
    expect(inputBox.width).toBeLessThanOrEqual(100);
    await cash.fill("9999");
    await expect(cash).toHaveValue("9999");
    expect(await quick.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    for (const button of await quick.getByRole("button").all()) {
      expect(await button.evaluate(el => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  }
  await expectCashButtonsBesideDiscount();
  await quick.getByRole("button", { name: "1000", exact: true }).click();
  await expect(change).toContainText(`$${1000 - firstAmount * 2}`);
  expect(await change.locator("strong").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(36);
  for (const button of await quick.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeLessThan(120);
  }
  await cash.fill("1");
  await expect(change).toContainText("實收金額不可小於應收金額");
  await expect(change.locator("strong")).toHaveCount(0);
  await cash.fill(String(firstAmount * 2));
  await expect(change).toContainText("$0");
  await page.locator("html").evaluate(el => { el.dataset.theme = "dark"; el.dataset.interfaceMode = "senior"; });
  await expectCashButtonsBesideDiscount();
  await quick.getByRole("button", { name: "1000", exact: true }).click();
  await expect(change).toContainText(`$${1000 - firstAmount * 2}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await change.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`checkout-${width}.png`), caret: "initial" });
  await composer.getByTestId("staff-checkout-back-icon").click();
  await composer.getByTestId("staff-cart-line").getByRole("button", { name: /^移除 / }).click();
  await expect(total).toContainText("0 份");
  await expect(total.locator("strong")).toHaveText("$0");
  expect(errors).toEqual([]);
});

test("既有訂單結帳的金額按鈕也位於折扣右側", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await page.getByTestId("staff-search-open").click();
  const search = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
  await search.getByRole("searchbox").fill(checkoutOrderNo);
  await search.getByRole("button", { name: "確認", exact: true }).click();
  await page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: checkoutOrderNo }).click();
  await page.getByTestId("staff-order-actions-pane").getByRole("button", { name: "結帳收款", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "結帳收款", exact: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ["standard", "senior"]) {
      await page.locator("html").evaluate((el, mode) => { el.dataset.interfaceMode = mode; }, mode);
      const discount = dialog.getByTestId("staff-discount-trigger");
      await discount.scrollIntoViewIfNeeded();
      const a = (await discount.boundingBox())!;
      const quick = dialog.getByTestId("cash-quick-amounts");
      const b = (await quick.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
      expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(2);
      const input = dialog.getByLabel("客戶實收金額", { exact: true });
      const inputBox = (await input.boundingBox())!;
      expect(inputBox.x).toBeGreaterThanOrEqual(b.x + b.width);
      expect(Math.abs(inputBox.y + inputBox.height / 2 - a.y - a.height / 2)).toBeLessThan(2);
      expect(inputBox.width).toBeLessThanOrEqual(100);
      await input.fill("9999");
      await expect(input).toHaveValue("9999");
      expect(await quick.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    for (const button of await quick.getByRole("button").all()) {
      expect(await button.evaluate(el => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
      await quick.getByRole("button", { name: "1000", exact: true }).click();
      await expect(dialog.getByLabel("客戶實收金額", { exact: true })).toHaveValue("1000");
      await expect(dialog.getByTestId("cash-change-summary").locator("strong")).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`existing-checkout-${width}.png`) });
  }
});

test("金流通路使用可鍵盤操作的複選標籤", async ({ page }, info) => {
  const paymentsPath = `/merchant/payments?organizationId=${organizationId}`;
  await expect.poll(async () => {
    // Chromium sends Secure login cookies to loopback HTTP; APIRequestContext does not.
    const response = await page.goto(paymentsPath);
    expect(new URL(page.url()).pathname).toBe("/merchant/payments");
    const status = response?.status();
    expect([200, 404]).toContain(status);
    return status;
  }).toBe(200);
  const delivery = page.getByRole("checkbox", { name: "外送", exact: true });
  await expect(delivery).not.toBeChecked();
  await delivery.locator("..").click();
  await expect(delivery).toBeChecked();
  await delivery.focus();
  await page.keyboard.press("Space");
  await expect(delivery).not.toBeChecked();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const box = await delivery.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(28);
    expect((await delivery.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("payment-channel-chips.png"), caret: "initial" });
});
