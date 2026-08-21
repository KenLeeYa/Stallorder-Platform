import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const primaryStallId = "22222222-2222-4222-8222-222222222222";
const tableQrToken = "demo-aming-chicken-table-a1-qr-2026";
const sourceSlug = "p1-template-source";
const targetSlug = "p1-template-target";
let sourceStallId = "";
let targetStallId = "";
let highDiscountId = "";
let additionalStallApprovalId = "";

test.describe("P1 營運功能", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await prisma.rateLimitBucket.deleteMany();
    await prisma.publicRateLimitBucket.deleteMany({ where: { stallId: primaryStallId } });
    await prisma.stall.deleteMany({ where: { slug: { in: [sourceSlug, targetSlug] } } });
    await prisma.discountOption.deleteMany({ where: { stallId: primaryStallId, name: "7 折 P1" } });
    await prisma.orderSession.deleteMany({ where: { order: { customerName: { startsWith: "P1 E2E" } } } });
    await prisma.order.deleteMany({ where: { stallId: primaryStallId, customerName: { startsWith: "P1 E2E" } } });
    await prisma.cashShift.deleteMany({ where: { stallId: primaryStallId, note: { startsWith: "P1 E2E" } } });

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId },
      select: { id: true },
    });
    additionalStallApprovalId = (await prisma.additionalStallApproval.create({
      data: {
        organizationId,
        subscriptionId: subscription.id,
        quantity: 2,
        unitPrice: 0,
        reason: "P1 E2E fixture",
      },
    })).id;

    const product = await prisma.product.findFirstOrThrow({ where: { organizationId, name: "香酥雞排" } });
    const source = await prisma.stall.create({
      data: {
        organizationId,
        name: "P1 範本來源攤位",
        slug: sourceSlug,
        code: "P1-SOURCE",
        address: "台北市測試路 1 號",
        location: "台北市測試路 1 號",
        orderingSettings: {
          create: {
            organizationId,
            paymentModuleEnabled: true,
            discountModuleEnabled: true,
            discountApprovalThresholdBps: 8500,
          },
        },
        businessHours: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId, dayOfWeek, opensAt: "10:00", closesAt: "20:00", isClosed: dayOfWeek === 1 })) },
        paymentOptions: { create: [{ organizationId, code: "P1_PAY", name: "P1 行動支付", kind: "CUSTOM", isEnabled: true, sortOrder: 1 }] },
        discountOptions: { create: [{ organizationId, name: "P1 九折", rateBps: 9000, isEnabled: true, sortOrder: 1 }] },
        stallProducts: { create: [{ organizationId, productId: product.id, isEnabled: true, isSoldOut: true, sortOrder: 1 }] },
      },
    });
    const target = await prisma.stall.create({
      data: {
        organizationId,
        name: "P1 範本目標攤位",
        slug: targetSlug,
        code: "P1-TARGET",
        address: "台北市測試路 2 號",
        location: "台北市測試路 2 號",
        orderingSettings: {
          create: {
            organizationId,
            paymentModuleEnabled: false,
            discountModuleEnabled: false,
            discountApprovalThresholdBps: 9500,
          },
        },
        businessHours: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId, dayOfWeek, opensAt: "17:00", closesAt: "23:00", isClosed: false })) },
      },
    });
    sourceStallId = source.id;
    targetStallId = target.id;
    highDiscountId = (await prisma.discountOption.create({
      data: { organizationId, stallId: primaryStallId, name: "7 折 P1", rateBps: 7000, isEnabled: true, sortOrder: 99 },
    })).id;
  });

  test.afterAll(async () => {
    await prisma.rateLimitBucket.deleteMany();
    await prisma.publicRateLimitBucket.deleteMany({ where: { stallId: primaryStallId } });
    await prisma.orderSession.deleteMany({ where: { order: { customerName: { startsWith: "P1 E2E" } } } });
    await prisma.order.deleteMany({ where: { stallId: primaryStallId, customerName: { startsWith: "P1 E2E" } } });
    await prisma.cashShift.deleteMany({ where: { stallId: primaryStallId, note: { startsWith: "P1 E2E" } } });
    if (highDiscountId) await prisma.discountOption.deleteMany({ where: { id: highDiscountId } });
    await prisma.stall.deleteMany({ where: { id: { in: [sourceStallId, targetStallId].filter(Boolean) } } });
    if (additionalStallApprovalId) {
      await prisma.additionalStallApproval.deleteMany({ where: { id: additionalStallApprovalId } });
    }
    await prisma.$disconnect();
  });

  test("同桌追加點餐可合併結帳、經理核准、列印重試並納入現金交班", async ({ browser, page }) => {
    test.setTimeout(180_000);
    await login(page, "staff@stallorder.test");
    await page.goto("/staff/aming-chicken/cash");
    const openShiftTrigger = page.getByRole("button", { name: "開始現金班次", exact: true });
    await expect(openShiftTrigger).toBeVisible();
    await openShiftTrigger.click();
    const openShiftDialog = page.getByRole("dialog", { name: "開啟現金班次", exact: true });
    await expect(openShiftDialog).toBeVisible();
    await openShiftDialog.getByLabel("開班金額").fill("2000");
    await openShiftDialog.getByLabel("備註（選填）").fill("P1 E2E 班次");
    await openShiftDialog.getByRole("button", { name: "開始班次", exact: true }).click();
    await expect(page.getByText("班次進行中", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^記錄收支/ }).click();
    const movementDialog = page.getByRole("dialog", { name: "記錄現金收支", exact: true });
    await expect(movementDialog).toBeVisible();
    await movementDialog.getByLabel("金額", { exact: true }).fill("500");
    await movementDialog.getByLabel("原因", { exact: true }).fill("P1 E2E 備用金");
    const movementResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/stalls/aming-chicken/cash-shifts")
      && response.request().method() === "POST"
    ));
    await movementDialog.getByRole("button", { name: "新增紀錄", exact: true }).click();
    expect((await movementResponse).status()).toBe(200);
    await expect(page.getByText(/P1 E2E 備用金/)).toBeVisible();

    const firstContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    const secondContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    const firstCustomer = await firstContext.newPage();
    const secondCustomer = await secondContext.newPage();
    const firstOrderNo = await createDineInOrder(firstCustomer, "P1 E2E 同桌甲", "Deep-Fried Chicken Cutlet");
    const secondOrderNo = await createDineInOrder(secondCustomer, "P1 E2E 同桌乙", "Sweet Potato Fries");

    await page.goto("/staff/aming-chicken");
    await page.getByRole("main").getByPlaceholder("搜尋桌號、訂單編號或顧客").fill("P1 E2E 同桌");
    for (const customerName of ["P1 E2E 同桌甲", "P1 E2E 同桌乙"]) {
      const order = page.getByRole("article").filter({ hasText: customerName });
      await order.getByRole("button", { name: "查看明細", exact: true }).click();
      await order.getByRole("button", { name: "確認接單", exact: true }).click();
      await order.getByRole("button", { name: "全部開始製作（1）" }).click();
      await order.getByRole("button", { name: "全部餐點完成（1）" }).click();
      await order.getByRole("button", { name: "全部標記已出餐（1）" }).click();
      await expect(order.getByText("已出餐", { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "同桌合併" }).click();
    const tableGroup = page.getByRole("article").filter({ hasText: firstOrderNo });
    await expect(tableGroup).toContainText(secondOrderNo);
    await tableGroup.getByRole("button", { name: "合併結帳（2 筆）" }).click();
    const checkout = page.getByRole("dialog", { name: "同桌合併結帳" });
    await checkout.getByRole("button", { name: "7 折 P1" }).click();
    await expect(checkout.getByText("此折扣超過店員免核准門檻")).toBeVisible();
    await checkout.getByLabel("折扣原因").fill("P1 E2E 等候補償");
    await checkout.getByLabel("經理帳號").fill("owner@stallorder.test");
    await checkout.getByLabel("經理密碼").fill(password);
    await checkout.getByRole("button", { name: "$500" }).click();
    await expect(checkout).toContainText("$106");
    await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
    await expect(checkout).toHaveCount(0);

    const checkedOutOrders = await prisma.order.findMany({
      where: { orderNo: { in: [firstOrderNo, secondOrderNo] }, stallId: primaryStallId },
      include: { payment: true, discountApprovedBy: true },
    });
    expect(checkedOutOrders).toHaveLength(2);
    expect(checkedOutOrders.every((order) => order.status === "COMPLETED" && order.discountApprovalReason === "P1 E2E 等候補償")).toBe(true);
    expect(checkedOutOrders.every((order) => order.discountApprovedBy?.email === "owner@stallorder.test")).toBe(true);
    expect(new Set(checkedOutOrders.map((order) => order.payment?.checkoutGroupId)).size).toBe(1);

    await page.goto("/staff/aming-chicken/print");
    const takeOverPrinter = page.getByRole("button", { name: "本機接手" }).first();
    await waitForReactHydration(takeOverPrinter);
    const heartbeatResponse = waitForPrintOperation(page, "HEARTBEAT");
    await takeOverPrinter.click();
    expect((await heartbeatResponse).status()).toBe(200);
    await expect(page.getByText(/本機接手中/)).toBeVisible();
    const initialJob = page.getByRole("article").filter({ hasText: firstOrderNo }).first();
    await expect(initialJob).toContainText("待列印");
    await runPrintAction(page, initialJob.getByRole("button", { name: "開始列印" }), "CLAIM");
    await runPrintAction(page, initialJob.getByRole("button", { name: "成功" }), "SUCCESS");
    await expect(initialJob).toContainText("列印成功");
    await runPrintAction(page, initialJob.getByRole("button", { name: "補印" }), "REPRINT");
    const reprintJob = page.getByRole("article")
      .filter({ hasText: firstOrderNo })
      .filter({ hasText: "補印" })
      .first();
    await expect(reprintJob).toContainText("補印");
    await runPrintAction(page, reprintJob.getByRole("button", { name: "開始列印" }), "CLAIM");
    await runPrintAction(page, reprintJob.getByRole("button", { name: "失敗" }), "FAIL");
    await expect(reprintJob).toContainText("列印失敗");
    await runPrintAction(page, reprintJob.getByRole("button", { name: "重試" }), "RETRY");
    await expect(reprintJob).toContainText("待列印");

    await page.goto("/staff/aming-chicken/cash");
    await expect(page.getByText("$2,606", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^盤點交班/ }).click();
    const closeShiftDialog = page.getByRole("dialog", { name: "盤點並交班", exact: true });
    await expect(closeShiftDialog).toBeVisible();
    await closeShiftDialog.getByLabel("實際盤點金額").fill("2606");
    await expect(page.getByText("帳款相符", { exact: true })).toBeVisible();
    await closeShiftDialog.getByRole("button", { name: "送出交班複核", exact: true }).click();
    await expect(page.getByText("等待複核", { exact: true })).toBeVisible();
    const pendingShift = await prisma.cashShift.findFirstOrThrow({ where: { stallId: primaryStallId, note: "P1 E2E 班次" }, orderBy: { openedAt: "desc" } });
    expect(pendingShift.status).toBe("CLOSING");
    expect(pendingShift.varianceAmount).toBe(0);

    const cancelContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    const cancelCustomer = await cancelContext.newPage();
    const cancelledOrderNo = await createDineInOrder(cancelCustomer, "P1 E2E 取消單", "Deep-Fried Chicken Cutlet");
    await page.goto("/staff/aming-chicken");
    const cancellationMain = page.getByRole("main");
    await cancellationMain.getByPlaceholder("搜尋桌號、訂單編號或顧客").fill("P1 E2E 取消單");
    const cancelledOrder = cancellationMain.getByRole("article").filter({ hasText: "P1 E2E 取消單" });
    await cancelledOrder.getByRole("button", { name: "查看明細", exact: true }).click();
    await cancelledOrder.getByRole("button", { name: "取消訂單" }).click();
    const cancellation = page.getByRole("alertdialog", { name: "確認取消訂單？" });
    await cancellation.getByLabel("取消原因").selectOption("SOLD_OUT");
    await cancellation.getByLabel(/補充說明/).fill("P1 E2E 商品售罄");
    const cancellationResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname.includes("/api/stalls/aming-chicken/orders/")
      && response.request().method() === "PATCH"
    ), { timeout: 30_000 });
    await cancellation.getByRole("button", { name: "確認取消訂單" }).click();
    expect((await cancellationResponse).status()).toBe(200);
    await expect(cancelledOrder).toHaveCount(0);
    const cancelledRecord = await prisma.order.findFirstOrThrow({ where: { stallId: primaryStallId, orderNo: cancelledOrderNo } });
    expect(cancelledRecord.cancellationReason).toBe("SOLD_OUT");
    expect(cancelledRecord.cancellationDetail).toBe("P1 E2E 商品售罄");

    await firstContext.close();
    await secondContext.close();
    await cancelContext.close();
  });

  test("多攤位範本先顯示差異再套用全部營運設定", async ({ page }) => {
    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/stalls/${targetStallId}/settings/templates`);
    await expect(page.getByRole("heading", { name: "多攤位範本", exact: true })).toBeVisible();
    const template = page.getByRole("region", { name: "多攤位範本", exact: true });
    await template.getByLabel("來源攤位").selectOption(sourceStallId);
    await template.getByRole("button", { name: "比較差異" }).click();
    await expect(template).toContainText("付款方式");
    await expect(template).toContainText("經理核准門檻：8.5 折以下");
    await expect(template).toContainText("商品供應");
    await expect(template).toContainText("營業時間");
    page.once("dialog", (dialog) => dialog.accept());
    await template.getByRole("button", { name: "套用所選設定" }).click();
    await expect(template.getByRole("status")).toContainText("攤位範本已套用");

    const [payment, discounts, products, hours, settings] = await Promise.all([
      prisma.paymentOption.findMany({ where: { stallId: targetStallId }, orderBy: { sortOrder: "asc" } }),
      prisma.discountOption.findMany({ where: { stallId: targetStallId }, orderBy: { sortOrder: "asc" } }),
      prisma.stallProduct.findMany({ where: { stallId: targetStallId } }),
      prisma.stallBusinessHour.findMany({ where: { stallId: targetStallId }, orderBy: { dayOfWeek: "asc" } }),
      prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: targetStallId } }),
    ]);
    expect(payment.map((option) => option.code)).toEqual(["P1_PAY"]);
    expect(discounts.map((option) => option.name)).toEqual(["P1 九折"]);
    expect(products).toHaveLength(1);
    expect(products[0]?.isSoldOut).toBe(true);
    expect(hours).toHaveLength(7);
    expect(hours.every((hour) => hour.opensAt === "10:00" && hour.closesAt === "20:00")).toBe(true);
    expect(settings.paymentModuleEnabled).toBe(true);
    expect(settings.discountModuleEnabled).toBe(true);
    expect(settings.discountApprovalThresholdBps).toBe(8500);
  });
});

async function login(page: Page, email: string) {
  const warmupResponse = await page.context().request.get("/api/auth/login");
  expect(warmupResponse.status()).toBe(405);
  await warmupResponse.dispose();
  await page.goto("/login");
  const emailLogin = page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true });
  await waitForReactHydration(emailLogin);
  await emailLogin.click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const submit = page.getByRole("button", { name: "登入", exact: true });
  await waitForReactHydration(submit);
  const loginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
    && response.request().method() === "POST"
  ), { timeout: 30_000 });
  await submit.click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=|\/staff\//, { timeout: 30_000 });
}

async function createDineInOrder(page: Page, customerName: string, productName: string) {
  await page.goto(`/q/${tableQrToken}`);
  await page.getByRole("button", { name: "點餐語言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  const product = page.getByRole("article").filter({ hasText: productName });
  await product.getByRole("button", { name: `Increase ${productName}` }).click();
  await product.getByRole("button", { name: "Add to cart", exact: true }).click();
  const waitAcknowledgment = page.getByRole("checkbox", { name: /I understand the estimated wait/ });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
  await page.getByLabel("Customer name").fill(customerName);
  const submitButton = page.getByRole("button", { name: "Place order", exact: true });
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  let responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/create-public-order") && response.request().method() === "POST");
  await submitButton.click();
  let response = await responsePromise;
  if (response.status() === 422) {
    await expect(response.json()).resolves.toMatchObject({ code: "WAIT_ACKNOWLEDGMENT_REQUIRED" });
    await expect(waitAcknowledgment).toBeVisible();
    await waitAcknowledgment.check();
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    responsePromise = page.waitForResponse((nextResponse) => new URL(nextResponse.url()).pathname.endsWith("/create-public-order") && nextResponse.request().method() === "POST");
    await submitButton.click();
    response = await responsePromise;
  }
  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  const orderText = await page.getByText(/^訂單 /).first().textContent();
  if (!orderText) throw new Error("找不到新訂單編號");
  return orderText.replace(/^訂單\s+/, "").trim();
}

async function waitForReactHydration(control: Locator) {
  await expect.poll(() => control.evaluate((element) => (
    Object.keys(element).some((key) => (
      key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
    ))
  )), { message: "等待 React 完成控制項 hydration" }).toBe(true);
}

function waitForPrintOperation(page: Page, operation: string) {
  return page.waitForResponse((response) => {
    if (
      !new URL(response.url()).pathname.endsWith("/print-jobs")
      || response.request().method() !== "POST"
    ) return false;
    try {
      const body = response.request().postDataJSON() as { operation?: string };
      return body.operation === operation;
    } catch {
      return false;
    }
  });
}

async function runPrintAction(page: Page, control: Locator, operation: string) {
  await expect(control).toBeEnabled();
  await waitForReactHydration(control);
  await expect(control).toBeEnabled();
  const response = waitForPrintOperation(page, operation);
  await control.click();
  expect((await response).status()).toBe(200);
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
}
