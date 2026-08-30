import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { dismissStaffStartReminder } from "./local-navigation";

const password = "StallOrderDemo!2026";
const tableQrToken = "demo-aming-chicken-table-a1-qr-2026";
const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const customerName = `內用 QA ${Date.now()}`;
const mobileViewport = { width: 390, height: 844 };
const compactViewport = { width: 320, height: 568 };
let cashShiftId = "";
let originalAcknowledgmentThresholdMinutes: number | null = null;
let originalStall: Awaited<ReturnType<typeof loadStall>> | null = null;
let originalTableQrCode: Awaited<ReturnType<typeof loadTableQrCode>> | null = null;

async function loadStall() {
  return prisma.stall.findUniqueOrThrow({
    where: { id: stallId },
    select: {
      orderingEnabled: true,
      orderingState: true,
      businessStatus: true,
      isSoldOut: true,
    },
  });
}

async function loadTableQrCode() {
  return prisma.qrCode.findUniqueOrThrow({
    where: { token: tableQrToken },
    select: { id: true, state: true, expiresAt: true },
  });
}

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
  const [capacity, stall, tableQrCode] = await Promise.all([
    prisma.stallCapacitySettings.findUniqueOrThrow({
      where: { stallId },
      select: { acknowledgmentThresholdMinutes: true },
    }),
    loadStall(),
    loadTableQrCode(),
  ]);
  originalAcknowledgmentThresholdMinutes = capacity.acknowledgmentThresholdMinutes;
  originalStall = stall;
  originalTableQrCode = tableQrCode;
  await prisma.$transaction([
    prisma.stallCapacitySettings.update({
      where: { stallId },
      data: { acknowledgmentThresholdMinutes: 1 },
    }),
    prisma.stall.update({
      where: { id: stallId },
      data: {
        orderingEnabled: true,
        orderingState: "OPEN",
        businessStatus: "OPEN",
        isSoldOut: false,
      },
    }),
    prisma.qrCode.update({
      where: { id: tableQrCode.id },
      data: { state: "ACTIVE", expiresAt: null },
    }),
  ]);
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
    if (
      originalAcknowledgmentThresholdMinutes !== null
      && originalStall !== null
      && originalTableQrCode !== null
    ) {
      await prisma.$transaction([
        prisma.stallCapacitySettings.update({
          where: { stallId },
          data: { acknowledgmentThresholdMinutes: originalAcknowledgmentThresholdMinutes },
        }),
        prisma.stall.update({ where: { id: stallId }, data: originalStall }),
        prisma.qrCode.update({
          where: { id: originalTableQrCode.id },
          data: {
            state: originalTableQrCode.state,
            expiresAt: originalTableQrCode.expiresAt,
          },
        }),
      ]);
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  const emailLoginButton = page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true });
  await waitForReactHydration(emailLoginButton);
  await emailLoginButton.click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=|\/staff\/|\/kitchen\?/);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  ))).toBe(true);
}

async function waitForReactHydration(control: Locator) {
  await expect.poll(() => control.evaluate((element) => (
    Object.keys(element).some((key) => (
      key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
    ))
  )), { message: "等待 React 完成控制項 hydration" }).toBe(true);
}

async function captureMobileScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.setViewportSize(mobileViewport);
  const path = testInfo.outputPath(`${name}-390x844.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function verifyCompactViewport(page: Page, targets: Locator[]) {
  await page.setViewportSize(compactViewport);
  await expectNoHorizontalOverflow(page);
  for (const target of targets) {
    await expect(target).toBeVisible();
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
  }
  await page.setViewportSize(mobileViewport);
}

test("內用桌位從 QR 點餐連動廚房、出餐與折扣結帳", async ({ browser, page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize(mobileViewport);
  await page.goto(`/q/${tableQrToken}`);
  await expect(page.getByRole("main").getByText("內用 · A1 桌", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "點餐語言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet" })).toBeVisible();
  const chickenCutlet = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet", exact: true }),
  });
  await chickenCutlet.getByRole("button", { name: "Increase Deep-Fried Chicken Cutlet" }).click();
  await chickenCutlet.getByRole("button", { name: "Add to cart", exact: true }).click();
  const cartLines = page.getByTestId("qr-cart-panel").getByTestId("qr-cart-line");
  await expect(cartLines).toHaveCount(1);
  const sweetPotatoFries = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Sweet Potato Fries", exact: true }),
  });
  await sweetPotatoFries.getByRole("button", { name: "Increase Sweet Potato Fries" }).click();
  await sweetPotatoFries.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(cartLines).toHaveCount(2);
  await expect(cartLines.filter({ hasText: "Deep-Fried Chicken Cutlet" })).toHaveCount(1);
  await expect(cartLines.filter({ hasText: "Sweet Potato Fries" })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await captureMobileScreenshot(page, testInfo, "01-customer-qr-menu");
  await verifyCompactViewport(page, [page.getByTestId("qr-mobile-cart-summary")]);
  await page.getByTestId("qr-mobile-cart-summary").click();
  await expect(page.getByTestId("qr-cart-panel")).toHaveAttribute("role", "dialog");
  await page.getByRole("button", { name: "Continue to checkout", exact: true }).click();
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
  await captureMobileScreenshot(page, testInfo, "02-customer-order-tracker");
  await verifyCompactViewport(page, [
    page.getByText("內用桌位", { exact: true }),
    page.getByRole("button", { name: "重新整理訂單" }),
  ]);

  const staffContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(staffPage);
  const staffMain = staffPage.getByRole("main");
  await expect(staffMain.getByRole("switch", { name: /新單提示音已(?:開啟|關閉)/ })).toBeVisible();
  await staffMain.getByPlaceholder("搜尋桌號、訂單編號或顧客").fill("A1");
  const staffOrder = staffMain.getByRole("article").filter({ hasText: customerName });
  await expect(staffOrder).toContainText("內用 · A1 桌");
  await staffOrder.getByRole("button", { name: "查看明細", exact: true }).click();
  const confirmationResponse = staffPage.waitForResponse((response) => {
    if (
      !new URL(response.url()).pathname.includes("/api/stalls/aming-chicken/orders/")
      || response.request().method() !== "PATCH"
    ) return false;
    try {
      return (response.request().postDataJSON() as { status?: string }).status === "CONFIRMED";
    } catch {
      return false;
    }
  });
  await staffOrder.getByRole("button", { name: "確認接單", exact: true }).click();
  expect((await confirmationResponse).status()).toBe(200);
  await expect(staffOrder.getByRole("button", { name: "確認接單", exact: true })).toHaveCount(0);
  await expect(staffOrder).toContainText("待製作");
  await captureMobileScreenshot(staffPage, testInfo, "03-staff-order-confirmed");
  await verifyCompactViewport(staffPage, [staffOrder, staffOrder.getByText("待製作", { exact: true }).first()]);

  const kitchenContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  const kitchenPage = await kitchenContext.newPage();
  await login(kitchenPage, "kitchen@stallorder.test");
  const kitchenOrder = kitchenPage.getByRole("article").filter({ hasText: "#" + orderNo });
  await expect(kitchenOrder).toBeVisible();
  await expectNoHorizontalOverflow(kitchenPage);
  await expect(kitchenOrder).toContainText("內用 A1 桌 · QR 點餐");
  const startPreparationButton = kitchenOrder.getByRole("button", { name: "開始製作", exact: true }).first();
  await captureMobileScreenshot(kitchenPage, testInfo, "04-kitchen-kds-order");
  await verifyCompactViewport(kitchenPage, [
    kitchenOrder,
    startPreparationButton,
  ]);
  await waitForReactHydration(startPreparationButton);
  await startPreparationButton.click();
  await expect(kitchenOrder.getByText("製作中", { exact: true }).first()).toBeVisible();
  await kitchenOrder.getByRole("button", { name: "整單完成", exact: true }).click();
  await expect(kitchenOrder.getByText("已完成", { exact: true })).toHaveCount(2);
  await expect(kitchenOrder.getByRole("button", { name: "退回待製作", exact: true })).toHaveCount(0);

  await expect(staffOrder.getByText("餐點完成", { exact: true })).toHaveCount(2, { timeout: 10_000 });
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
  await staffPage.getByRole("button", { name: "訂單看板" }).click();
  await expect(staffPage).toHaveURL(/\/staff\/aming-chicken$/);
  await expect(staffOrder.getByText("待結帳／交付", { exact: true })).toBeVisible();
  const summaryCheckoutButton = staffOrder.getByRole("button", { name: "代結帳", exact: true }).first();
  await expect(summaryCheckoutButton).toBeVisible();
  await staffOrder.getByRole("button", { name: "查看明細", exact: true }).click();
  await expect(staffOrder.getByText("已出餐", { exact: true })).toHaveCount(2);
  await expect(staffOrder.getByLabel("3 位數取餐碼")).toHaveCount(0);
  await summaryCheckoutButton.click();

  const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
  await expect(checkout.getByRole("button", { name: "LINE Pay" })).toBeVisible();
  await expect(checkout.getByRole("button", { name: "街口支付" })).toBeVisible();
  await expectNoHorizontalOverflow(staffPage);
  await checkout.getByRole("button", { name: "9 折" }).click();
  await checkout.getByRole("button", { name: "$500" }).click();
  await expect(checkout).toContainText("$135");
  await expect(checkout).toContainText("$365");
  await captureMobileScreenshot(staffPage, testInfo, "05-staff-checkout");
  await verifyCompactViewport(staffPage, [
    checkout,
    checkout.getByRole("button", { name: "完成訂單", exact: true }),
  ]);
  await staffPage.route("**/api/stalls/aming-chicken/orders/*", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "現金交易前必須先開啟現金班次。",
        code: "ACTIVE_SHIFT_REQUIRED",
      }),
    });
  }, { times: 1 });
  const rejectedCheckoutResponse = staffPage.waitForResponse((response) => (
    response.url().includes("/api/stalls/aming-chicken/orders/")
    && response.request().method() === "PATCH"
  ));
  await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
  expect((await rejectedCheckoutResponse).status()).toBe(409);
  await expect(checkout.getByRole("alert")).toContainText("現金交易前必須先開啟現金班次。");
  await expect(checkout.getByRole("link", { name: "前往現金交班" })).toHaveAttribute("href", "/staff/aming-chicken/cash");
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
  await waitForReactHydration(cleaningTable);
  await cleaningTable.click();
  const finishCleaning = staffPage.getByRole("button", { name: "清潔完成，設為空桌" });
  await expect(finishCleaning).toBeVisible();
  await finishCleaning.click();
  await expect(staffPage.getByRole("button", { name: /A1 桌，空桌/ })).toBeVisible();

  await page.getByRole("button", { name: "重新整理訂單" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已付款", { exact: true })).toBeVisible();
  await expect(page.getByText("已出餐", { exact: true })).toHaveCount(2);
  await expectNoHorizontalOverflow(page);

  const merchantContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  const merchantPage = await merchantContext.newPage();
  await login(merchantPage, "owner@stallorder.test");
  await expect(merchantPage.getByRole("region", { name: "營運摘要" })).toBeVisible();
  await expectNoHorizontalOverflow(merchantPage);
  await captureMobileScreenshot(merchantPage, testInfo, "06-merchant-dashboard");
  await verifyCompactViewport(merchantPage, [merchantPage.getByRole("region", { name: "營運摘要" })]);
  await merchantPage.goto(`/merchant/reports/overview?organizationId=${organizationId}`);
  await expect(merchantPage.getByRole("heading", { name: "銷售趨勢總覽", exact: true })).toBeVisible();
  await expect(
    merchantPage.getByRole("region", { name: "銷售摘要" }).getByTestId("sales-summary-dashboard"),
  ).toBeVisible();
  await expectNoHorizontalOverflow(merchantPage);
  await captureMobileScreenshot(merchantPage, testInfo, "07-merchant-sales-report");
  await verifyCompactViewport(merchantPage, [
    merchantPage.getByRole("heading", { name: "銷售趨勢總覽", exact: true }),
    merchantPage.getByRole("region", { name: "銷售摘要" }).getByTestId("sales-summary-dashboard"),
  ]);

  await merchantContext.close();
  await kitchenContext.close();
  await staffContext.close();
});
