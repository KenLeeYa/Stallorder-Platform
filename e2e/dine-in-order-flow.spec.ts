import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const password = "StallOrderDemo!2026";
const tableQrToken = "demo-aming-chicken-table-a1-qr-2026";
const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const customerName = `內用 QA ${Date.now()}`;
let cashShiftId = "";
let originalAcknowledgmentThresholdMinutes = 30;

test.beforeAll(async () => {
  await prisma.order.deleteMany({
    where: { stallId, customerName: { startsWith: "內用 QA " } },
  });
  const staleShifts = await prisma.cashShift.findMany({
    where: { stallId, note: "Dine-in E2E 班次" },
    select: { id: true },
  });
  const staleShiftIds = staleShifts.map((shift) => shift.id);
  if (staleShiftIds.length > 0) {
    await prisma.cashShiftReview.deleteMany({ where: { cashShiftId: { in: staleShiftIds } } });
    await prisma.cashShift.deleteMany({ where: { id: { in: staleShiftIds } } });
  }
  await prisma.diningTable.update({
    where: { stallId_code: { stallId, code: "A1" } },
    data: { serviceState: "EMPTY", seatedAt: null },
  });
  const capacity = await prisma.stallCapacitySettings.findUniqueOrThrow({
    where: { stallId },
    select: { acknowledgmentThresholdMinutes: true },
  });
  originalAcknowledgmentThresholdMinutes = capacity.acknowledgmentThresholdMinutes;
  await prisma.stallCapacitySettings.update({
    where: { stallId },
    data: { acknowledgmentThresholdMinutes: 1 },
  });
  const staff = await prisma.profile.findUniqueOrThrow({
    where: { email: "staff@stallorder.test" },
    select: { id: true },
  });
  const shift = await prisma.cashShift.create({
    data: {
      organizationId,
      stallId,
      openingAmount: 0,
      openedById: staff.id,
      note: "Dine-in E2E 班次",
    },
  });
  cashShiftId = shift.id;
});

test.afterAll(async () => {
  try {
    await prisma.order.deleteMany({ where: { stallId, customerName } });
    if (cashShiftId) {
      await prisma.cashShiftReview.deleteMany({ where: { cashShiftId } });
      await prisma.cashShift.deleteMany({ where: { id: cashShiftId } });
    }
    await prisma.diningTable.update({
      where: { stallId_code: { stallId, code: "A1" } },
      data: { serviceState: "EMPTY", seatedAt: null },
    });
    await prisma.stallCapacitySettings.update({
      where: { stallId },
      data: { acknowledgmentThresholdMinutes: originalAcknowledgmentThresholdMinutes },
    });
  } finally {
    await prisma.$disconnect();
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard|\/staff\/|\/kitchen\?/);
}

test("內用桌位從 QR 點餐連動廚房、出餐與折扣結帳", async ({ browser, page }) => {
  test.setTimeout(180_000);
  await page.goto(`/q/${tableQrToken}`);
  await expect(page.getByRole("main").getByText("內用 · A1 桌", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "點餐語言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet" })).toBeVisible();
  await page.getByRole("button", { name: "Increase Deep-Fried Chicken Cutlet" }).click();
  await page.getByRole("button", { name: "Increase Sweet Potato Fries" }).click();
  await page.getByLabel("Customer name").fill(customerName);
  await page.getByRole("checkbox", { name: /I understand the estimated wait/ }).check();
  await expect(page.getByRole("button", { name: "Place order", exact: true })).toBeEnabled({ timeout: 15_000 });

  const createResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  const orderNumberLabel = await page.getByText(/^訂單 /).first().innerText();
  const orderNo = orderNumberLabel.replace(/^訂單 /, "");
  await expect(page.getByText("內用桌位", { exact: true })).toBeVisible();
  await expect(page.getByText("A1 桌", { exact: true })).toBeVisible();
  await expect(page.getByText("取餐驗證碼", { exact: true })).toHaveCount(0);

  const staffContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  const staffMain = staffPage.getByRole("main");
  await expect(staffMain.getByRole("switch", { name: /新訂單提醒/ })).toBeVisible();
  await staffMain.getByPlaceholder("搜尋桌號、訂單編號或顧客").fill("A1");
  const staffOrder = staffMain.getByRole("article").filter({ hasText: customerName });
  await expect(staffOrder).toContainText("內用 · A1 桌");
  await staffOrder.getByRole("button", { name: "確認接單" }).click();
  await expect(staffOrder).toContainText("已確認");

  const kitchenContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const kitchenPage = await kitchenContext.newPage();
  await login(kitchenPage, "kitchen@stallorder.test");
  const kitchenOrder = kitchenPage.getByRole("article").filter({ hasText: "#" + orderNo });
  await expect(kitchenOrder).toBeVisible();
  await expect(kitchenOrder).toContainText("內用 A1 桌 · QR 點餐");
  await kitchenOrder.getByRole("button", { name: "開始製作", exact: true }).first().click();
  await expect(kitchenOrder.getByText("製作中", { exact: true }).first()).toBeVisible();
  await kitchenOrder.getByRole("button", { name: "整單完成", exact: true }).click();
  await expect(kitchenOrder.getByText("已完成", { exact: true })).toHaveCount(2);
  await expect(kitchenOrder.getByRole("button", { name: "退回待製作", exact: true })).toHaveCount(0);

  await expect(staffOrder).toContainText("已完成餐點", { timeout: 10_000 });
  await staffPage.getByRole("link", { name: "桌位平面圖" }).click();
  await expect(staffPage).toHaveURL(/\/staff\/aming-chicken\/floor/);
  await expect(staffPage.getByRole("region", { name: "內用桌位平面" })).toBeVisible();
  await staffPage.getByRole("button", { name: /^A1 桌，/ }).click();
  const tableDetail = staffPage.getByRole("region", { name: "A1 桌" });
  await expect(tableDetail).toContainText(customerName);
  const tableOrder = tableDetail.locator("article").filter({ hasText: customerName });
  await tableOrder.getByRole("button", { name: "全部標記已出餐（2）", exact: true }).click();
  await expect(tableOrder.getByText("已出餐", { exact: true })).toHaveCount(2);
  expect(await staffPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await staffPage.getByRole("link", { name: "訂單看板" }).click();
  await expect(staffPage).toHaveURL(/\/staff\/aming-chicken$/);
  await expect(staffOrder.getByText("已出餐", { exact: true })).toHaveCount(2);
  await expect(staffOrder.getByLabel("三位數取餐碼")).toHaveCount(0);
  await staffOrder.getByRole("button", { name: "完成訂單" }).click();

  const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
  await expect(checkout.getByRole("button", { name: "LINE Pay" })).toBeVisible();
  await expect(checkout.getByRole("button", { name: "街口支付" })).toBeVisible();
  await checkout.getByRole("button", { name: "9 折" }).click();
  await checkout.getByRole("button", { name: "$500" }).click();
  await expect(checkout).toContainText("$135");
  await expect(checkout).toContainText("$365");
  const checkoutResponse = staffPage.waitForResponse((response) => (
    response.url().includes("/api/stalls/aming-chicken/orders/")
    && response.request().method() === "PATCH"
  ));
  await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
  expect((await checkoutResponse).status()).toBe(200);
  await expect(staffOrder).toHaveCount(0);
  const completedOrder = await prisma.order.findFirstOrThrow({
    where: { stallId, customerName },
    include: { payment: true },
  });
  expect(completedOrder.payment?.cashShiftId).toBe(cashShiftId);

  await staffPage.goto("/staff/aming-chicken/floor");
  const cleaningTable = staffPage.getByRole("button", { name: /A1 桌，待清潔/ });
  await expect(cleaningTable).toBeVisible({ timeout: 10_000 });
  await cleaningTable.click();
  await staffPage.getByRole("button", { name: "清潔完成，設為空桌" }).click();
  await expect(staffPage.getByRole("button", { name: /A1 桌，空桌/ })).toBeVisible();

  await page.getByRole("button", { name: "重新整理訂單" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已付款", { exact: true })).toBeVisible();
  await expect(page.getByText("已出餐", { exact: true })).toHaveCount(2);

  await kitchenContext.close();
  await staffContext.close();
});
