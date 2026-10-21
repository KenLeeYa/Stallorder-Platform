import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { addFirstStaffCatalogProduct, dismissStaffStartReminder, loginLocalTestAccount } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const createdOrderIds: string[] = [];
let createdCashShiftId = "";

test.use({ serviceWorkers: "block", viewport: { width: 1024, height: 900 }, trace: "off", video: "off", screenshot: "only-on-failure" });
test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(database.hostname)
    || database.port !== (process.env.CI ? "54322" : "55722")) throw new Error("LOCAL_QA_DATABASE_REQUIRED");
  const activeShift = await prisma.cashShift.findFirst({ where: { organizationId, stallId, status: "OPEN" }, select: { id: true } });
  if (!activeShift) {
    const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" }, select: { id: true } });
    createdCashShiftId = (await prisma.cashShift.create({ data: {
      organizationId, stallId, openingAmount: 0, openedById: owner.id, note: "Isolated staff delivery checkout regression",
    } })).id;
  }
});
test.afterAll(async () => {
  try {
    if (createdOrderIds.length) {
      await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    if (createdCashShiftId) {
      await prisma.cashShiftReview.deleteMany({ where: { cashShiftId: createdCashShiftId } });
      await prisma.cashMovement.deleteMany({ where: { cashShiftId: createdCashShiftId } });
      await prisma.cashShift.deleteMany({ where: { id: createdCashShiftId } });
    }
  } finally { await prisma.$disconnect(); }
});
test.beforeEach(() => {
  const db = new URL(process.env.DATABASE_URL ?? "https://invalid");
  const app = new URL(process.env.PLAYWRIGHT_APP_URL ?? "http://invalid");
  if (!["127.0.0.1", "localhost"].includes(app.hostname) || !["127.0.0.1", "localhost"].includes(db.hostname)) {
    throw new Error("LOCAL_FIXTURE_ONLY");
  }
});

for (const scenario of [
  { name: "外送省略聯絡資料稍後結帳", type: "DELIVERY", phone: "", address: "", payNow: false },
  { name: "外送僅電話立即結帳", type: "DELIVERY", phone: "0912345678", address: "", payNow: true },
  { name: "外送僅地址稍後結帳", type: "DELIVERY", phone: "", address: "本機 QA 測試地址", payNow: false },
  { name: "外送完整聯絡資料稍後結帳", type: "DELIVERY", phone: "0912345678", address: "本機 QA 測試地址", payNow: false },
  { name: "外帶省略聯絡資料立即結帳", type: "TAKEOUT", phone: "", address: "", payNow: true },
] as const) test(`店員新增訂單：${scenario.name}`, async ({ page }, info) => {
  test.setTimeout(120_000);
  await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await page.getByRole("button", { name: "店員點餐", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "店員點餐", exact: true });
  await dialog.getByRole("button", { name: scenario.type === "DELIVERY" ? "外送" : "外帶自取", exact: true }).click();
  if (scenario.type === "DELIVERY") await dialog.getByLabel("地址（選填）", { exact: true }).fill(scenario.address);
  await dialog.locator('input[type="tel"]').fill(scenario.phone);
  await addFirstStaffCatalogProduct(page, dialog);
  await dialog.getByLabel("顧客名稱（選填）", { exact: true }).fill(`本機外送回歸 ${Date.now()}`);
  await dialog.getByTestId("staff-tablet-confirm-order").click();
  await dialog.getByRole("button", { name: scenario.payNow ? "立即結帳" : "稍後結帳", exact: true }).click();
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === "/api/stalls/aming-chicken/orders" && r.request().method() === "POST");
  await dialog.getByRole("button", { name: scenario.payNow ? "建立訂單並收款" : "建立訂單送入廚房", exact: true }).click();
  const response = await pending;
  const body = await response.json();
  if (body.order?.id) createdOrderIds.push(body.order.id);
  mkdirSync(info.outputDir, { recursive: true });
  writeFileSync(info.outputPath("create-result.json"), JSON.stringify({ status: response.status(), code: body.code, error: body.error,
    order: body.order ? { id: body.order.id, orderNo: body.order.orderNo, fulfillmentType: body.order.fulfillmentType, status: body.order.status, paymentStatus: body.order.paymentStatus } : null }, null, 2));
  expect(response.status(), body.error ?? body.code).toBe(201);
  expect(body.order).toMatchObject({ fulfillmentType: scenario.type, status: "CONFIRMED", paymentStatus: scenario.payNow ? "PAID" : "UNPAID" });
  await expect(dialog).not.toBeVisible();
  await page.getByTestId("staff-search-open").click();
  const search = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
  await search.getByRole("searchbox").fill(body.order.orderNo);
  await search.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: body.order.orderNo })).toBeVisible();
  await page.reload();
  await dismissStaffStartReminder(page);
  await page.getByTestId("staff-search-open").click();
  await search.getByRole("searchbox").fill(body.order.orderNo);
  await search.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: body.order.orderNo })).toBeVisible();
});

test("商戶全部功能依裝置展開，手機可從所有功能進入會員與成長", async ({ page }, info) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
  await page.goto("/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111");
  const navigation = page.getByTestId("merchant-function-navigation");
  const all = navigation.getByRole("button", { name: "所有功能", exact: true });
  const links = navigation.getByRole("link");
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(navigation).toBeVisible();
    const allLinks = await navigation.locator("a").count();
    if (width >= 768) {
      await expect(all).toBeHidden();
      expect(await links.count()).toBe(allLinks);
      for (const link of await links.all()) await expect(link).toBeVisible();
      expect(await navigation.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    } else {
      await expect(all).toBeVisible();
      expect(await links.count()).toBeLessThanOrEqual(5);
      expect(await links.count()).toBeLessThan(allLinks);
    }
    expect(await navigation.locator("a:visible > span:visible, button:visible > span:visible").count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`merchant-${width}.png`), caret: "initial" });
  }
  await page.getByRole("button", { name: "切換為年長者模式", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-interface-mode", "senior");
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    if (width >= 768) {
      await expect(all).toBeHidden();
      for (const link of await links.all()) {
        const box = await link.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    } else await expect(all).toBeVisible();
    const box = await links.first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`merchant-senior-${width}.png`), caret: "initial" });
  }
  await all.click();
  const directory = page.getByRole("dialog", { name: "所有功能", exact: true });
  await expect(directory).toBeVisible();
  const destination = directory.getByRole("link").filter({ hasText: "會員與成長" });
  const startedAt = Date.now();
  let releaseNavigation!: () => void;
  let navigationStarted!: () => void;
  const held = new Promise<void>(resolve => { releaseNavigation = resolve; });
  const started = new Promise<void>(resolve => { navigationStarted = resolve; });
  await page.route(/\/merchant\/growth(?:\?|$)/, async route => {
    navigationStarted();
    await held;
    await route.continue();
  });
  // Next dev may compile this route on first access. Capture its response, not a second click.
  const navigated = page.waitForResponse(response => new URL(response.url()).pathname === "/merchant/growth", { timeout: 45_000 });
  try {
    await destination.click();
    await started;
    await expect(directory).toBeVisible();
  } finally {
    releaseNavigation();
  }
  const response = await navigated;
  await page.unrouteAll({ behavior: "wait" });
  writeFileSync(info.outputPath("navigation-result.json"), JSON.stringify({ status: response.status(), responseMs: Date.now() - startedAt, pageErrors }, null, 2));
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/growth\?/);
  await expect(page.getByRole("heading", { level: 1, name: "會員與成長" })).toBeVisible();
  await expect(directory).toBeHidden();
  await expect(page.getByText("建立有預算、期限、通路與每客上限的優惠活動；集點、推薦、RFM 與自動化共用同意治理。", { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
