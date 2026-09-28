import { expect, test } from "@playwright/test";
import { addFirstStaffCatalogProduct, dismissStaffStartReminder, loginLocalTestAccount } from "./local-navigation";

test.use({ serviceWorkers: "block", trace: "off", video: "off" });
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
  await page.getByRole("button", { name: /^待交付\s*[／/]\s*結帳/ }).click();
  const cards = page.getByTestId("staff-order-list-pane").getByRole("button");
  let opened = false;
  for (const card of await cards.all()) {
    await card.click();
    const checkout = page.getByTestId("staff-order-actions-pane").getByRole("button", { name: "結帳收款", exact: true });
    if (await checkout.isVisible()) { await checkout.click(); opened = true; break; }
  }
  expect(opened, "本機範例須有待結帳訂單").toBe(true);
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
  await page.goto("/merchant/payments?organizationId=11111111-1111-4111-8111-111111111111");
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
