import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const createdOrderIds: string[] = [];
let originalDeliveryEnabled = false;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 30_000 });
}

test.beforeAll(async () => {
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({
    where: { stallId },
    select: { deliveryModuleEnabled: true },
  });
  originalDeliveryEnabled = settings.deliveryModuleEnabled;
  await prisma.stallOrderingSettings.update({
    where: { stallId },
    data: { deliveryModuleEnabled: true },
  });
});

test.afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  await prisma.stallOrderingSettings.update({
    where: { stallId },
    data: { deliveryModuleEnabled: originalDeliveryEnabled },
  });
  await prisma.$disconnect();
});

test("內用顧客名稱與桌位欄位在桌面版對齊", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await login(page);
  await page.goto("/staff/aming-chicken");
  await page.getByRole("button", { name: "店員點餐" }).click();

  const dialog = page.getByRole("dialog", { name: "店員點餐與結帳" });
  await dialog.getByRole("button", { name: "內用", exact: true }).click();
  const customerNameInput = dialog.getByLabel("顧客名稱（選填）");
  const tableSelect = dialog.getByLabel("桌位");
  const [customerBox, tableBox] = await Promise.all([
    customerNameInput.boundingBox(),
    tableSelect.boundingBox(),
  ]);

  expect(customerBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(Math.abs(customerBox!.y - tableBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(customerBox!.height - tableBox!.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("staff-pos-dine-in-alignment.png"), fullPage: true });
});

test("店員可在手機介面代客點餐並立即完成收款", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/staff/aming-chicken");
  await expect(page.getByRole("button", { name: "店員點餐" })).toBeVisible();
  await page.getByRole("button", { name: "店員點餐" }).click();

  const dialog = page.getByRole("dialog", { name: "店員點餐與結帳" });
  await expect(dialog).toBeVisible();
  await dialog.getByTitle(/^增加 /).first().click();
  const fieldsets = dialog.locator("fieldset");
  for (let index = 0; index < await fieldsets.count(); index += 1) {
    const fieldset = fieldsets.nth(index);
    if ((await fieldset.locator("legend").innerText()).includes("*")) {
      await fieldset.locator('input[type="radio"], input[type="checkbox"]').first().check();
    }
  }

  const orderResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/orders")
    && response.request().method() === "POST"
  ));
  await dialog.getByRole("button", { name: "建立訂單並收款" }).click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  const payload = await orderResponse.json();
  createdOrderIds.push(payload.order.id);
  expect(payload.order).toMatchObject({
    source: "STAFF_POS",
    status: "CONFIRMED",
    paymentStatus: "PAID",
    fulfillmentType: "TAKEOUT",
    pickupCodeLength: 3,
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/已建立、完成收款並送入廚房/)).toBeVisible();

  const stored = await prisma.order.findUniqueOrThrow({
    where: { id: payload.order.id },
    include: { payment: true, printJobs: true },
  });
  expect(stored.pickupCodeHash).toBeNull();
  expect(stored.payment?.status).toBe("PAID");
  expect(stored.printJobs[0]?.status).toBe("PENDING");
  await page.screenshot({ path: testInfo.outputPath("staff-pos-mobile.png"), fullPage: true });
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);

  await prisma.order.update({ where: { id: payload.order.id }, data: { status: "READY" } });
  await page.reload();
  const ticket = page.locator("article").filter({ hasText: `訂單 ${payload.order.orderNo}` });
  const prematureCompletion = page.waitForResponse((response) => (
    response.url().endsWith(`/api/stalls/aming-chicken/orders/${payload.order.id}`)
    && response.request().method() === "PATCH"
  ));
  await ticket.getByRole("button", { name: "完成訂單", exact: true }).click();
  expect((await prematureCompletion).status()).toBe(409);
  await expect(page.getByText("仍有餐點尚未完成製作。", { exact: true })).toBeVisible();
});

test("LINE 固定外送網址建立受保護 session 並顯示外送欄位", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const customerName = `LINE 外送 QA ${Date.now()}`;
  const deliveryAddress = "台北市信義區測試路 1 號 2 樓";
  await page.goto("/delivery/aming-chicken");
  await expect(page.getByLabel("聯絡電話")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("外送地址")).toBeVisible();
  await expect(page.getByText("外送", { exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("line-delivery-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: /^增加 / }).first().click();
  const requiredGroups = page.locator("fieldset").filter({ has: page.locator("legend") });
  for (let index = 0; index < await requiredGroups.count(); index += 1) {
    const group = requiredGroups.nth(index);
    if ((await group.locator("legend").innerText()).includes("*")) {
      await group.locator('input[type="radio"], input[type="checkbox"]').first().check();
    }
  }
  await page.getByLabel("顧客稱呼").fill(customerName);
  await page.getByLabel("聯絡電話").fill("0912345678");
  await page.getByLabel("外送地址").fill(deliveryAddress);
  const submit = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  const createResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await submit.click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText(deliveryAddress, { exact: true })).toBeVisible();
  await expect(page.getByText("取餐驗證碼", { exact: true })).toHaveCount(0);

  const order = await prisma.order.findFirstOrThrow({
    where: { stallId, source: "LINE_DELIVERY", customerName },
    select: {
      id: true,
      fulfillmentType: true,
      status: true,
      pickupCodeHash: true,
      deliveryAddress: true,
      customerPhone: true,
    },
  });
  createdOrderIds.push(order.id);
  expect(order).toMatchObject({
    fulfillmentType: "DELIVERY",
    status: "WAITING_CONFIRMATION",
    pickupCodeHash: null,
    deliveryAddress,
    customerPhone: "0912345678",
  });
});

test("外送頁依瀏覽器語系顯示英文欄位", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const appUrl = process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001";
    await page.goto(`${appUrl}/delivery/aming-chicken`);
    await expect(page.getByLabel("Contact phone")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Delivery address")).toBeVisible();
    await expect(page.getByText("Delivery", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
