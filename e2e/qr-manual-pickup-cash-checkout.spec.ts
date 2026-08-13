import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";
const password = "StallOrderDemo!2026";
const testMarker = `QR 人工現金 E2E ${Date.now()}-${randomUUID().slice(0, 8)}`;

let activeCashShiftId = "";
let createdCashShiftId = "";
let createdOrderId = "";
let createdSessionId = "";
let createdPaymentId = "";
let cashPaymentOptionId = "";

test.describe("外帶 QR 人工核對與現金完成訂單", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [stall, qrCode, cashPaymentOption, staff, openCashShift] = await Promise.all([
      prisma.stall.findUniqueOrThrow({
        where: { id: stallId },
        select: {
          isActive: true,
          businessStatus: true,
          orderingEnabled: true,
          orderingState: true,
          isSoldOut: true,
          orderingSettings: { select: { paymentModuleEnabled: true } },
        },
      }),
      prisma.qrCode.findUniqueOrThrow({
        where: { token: takeoutQrToken },
        select: { state: true, expiresAt: true },
      }),
      prisma.paymentOption.findUniqueOrThrow({
        where: { stallId_code: { stallId, code: "CASH" } },
        select: { id: true, isEnabled: true },
      }),
      prisma.profile.findUniqueOrThrow({
        where: { email: "staff@stallorder.test" },
        select: { id: true },
      }),
      prisma.cashShift.findFirst({
        where: { organizationId, stallId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      }),
    ]);

    expect(stall).toMatchObject({
      isActive: true,
      businessStatus: "OPEN",
      orderingEnabled: true,
      orderingState: "OPEN",
      isSoldOut: false,
      orderingSettings: { paymentModuleEnabled: true },
    });
    expect(qrCode.state).toBe("ACTIVE");
    expect(qrCode.expiresAt === null || qrCode.expiresAt.getTime() > Date.now()).toBe(true);
    expect(cashPaymentOption.isEnabled).toBe(true);
    cashPaymentOptionId = cashPaymentOption.id;

    if (openCashShift) {
      activeCashShiftId = openCashShift.id;
      return;
    }

    const createdShift = await prisma.cashShift.create({
      data: {
        organizationId,
        stallId,
        openingAmount: 0,
        openedById: staff.id,
        note: testMarker,
      },
      select: { id: true },
    });
    activeCashShiftId = createdShift.id;
    createdCashShiftId = createdShift.id;
  });

  test.afterAll(async () => {
    try {
      await resolveCreatedRecordIds();

      if (createdSessionId) {
        await prisma.publicOrderAttempt.deleteMany({
          where: { orderSessionId: createdSessionId },
        });
        await prisma.orderSession.deleteMany({ where: { id: createdSessionId } });
      }
      if (createdPaymentId) {
        await prisma.payment.deleteMany({ where: { id: createdPaymentId } });
      }
      if (createdOrderId) {
        await prisma.order.deleteMany({ where: { id: createdOrderId } });
      }
      if (createdCashShiftId) {
        await prisma.cashShiftReview.deleteMany({ where: { cashShiftId: createdCashShiftId } });
        await prisma.cashMovement.deleteMany({ where: { cashShiftId: createdCashShiftId } });
        await prisma.cashShift.deleteMany({ where: { id: createdCashShiftId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("真實 QR 下單經人工核對後，以現金完成訂單", async ({ browser, page }) => {
    test.setTimeout(180_000);

    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${takeoutQrToken}`);
    const sessionResponse = await sessionResponsePromise;
    expect([200, 201]).toContain(sessionResponse.status());
    const sessionPayload = await sessionResponse.json() as { orderSessionToken?: string };
    expect(sessionPayload.orderSessionToken).toEqual(expect.any(String));
    const sessionTokenHash = createHash("sha256")
      .update(sessionPayload.orderSessionToken as string)
      .digest("hex");
    createdSessionId = (await prisma.orderSession.findUniqueOrThrow({
      where: { tokenHash: sessionTokenHash },
      select: { id: true },
    })).id;

    await page.getByRole("button", { name: "點餐語言" }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    const chickenCutlet = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet", exact: true }),
    });
    await chickenCutlet.getByRole("button", { name: "Increase Deep-Fried Chicken Cutlet" }).click();
    await chickenCutlet.getByRole("button", { name: "Add to cart", exact: true }).click();
    await page.getByLabel("Customer name").fill(testMarker);
    const waitAcknowledgment = page.getByRole("checkbox", { name: /I understand the estimated wait/ });
    if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
    await expect(page.getByRole("button", { name: "Place order", exact: true })).toBeEnabled({ timeout: 20_000 });

    const createOrderResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-public-order")
      && response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "Place order", exact: true }).click();
    const createOrderResponse = await createOrderResponsePromise;
    expect(createOrderResponse.status()).toBe(201);
    await expect(page).toHaveURL(/\/order\//);
    await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);
    const orderNumberText = await page.getByText(/^訂單 /u).textContent();
    const orderNo = orderNumberText?.replace(/^訂單\s*/u, "") ?? "";
    expect(orderNo).not.toBe("");

    const createdOrder = await prisma.order.findUniqueOrThrow({
      where: { stallId_orderNo: { stallId, orderNo } },
      select: {
        id: true,
        fulfillmentType: true,
        status: true,
        paymentStatus: true,
        total: true,
        orderSession: { select: { id: true } },
      },
    });
    createdOrderId = createdOrder.id;
    expect(createdOrder).toMatchObject({
      fulfillmentType: "TAKEOUT",
      status: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
    });
    expect(createdOrder.orderSession?.id).toBe(createdSessionId);

    const staffContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: { width: 390, height: 844 },
    });
    try {
      const staffPage = await staffContext.newPage();
      await login(staffPage);
      await staffPage.goto("/staff/aming-chicken");
      const staffOrder = staffPage.getByRole("article").filter({ hasText: testMarker });
      await expect(staffOrder).toBeVisible();
      await staffOrder.getByRole("button", { name: "查看明細", exact: true }).click();

      const confirmResponsePromise = waitForOrderPatch(staffPage, createdOrderId);
      await staffOrder.getByRole("button", { name: "待製作", exact: true }).click();
      const confirmResponse = await confirmResponsePromise;
      expect(confirmResponse.status()).toBe(200);
      expect(confirmResponse.request().postDataJSON()).toMatchObject({ status: "CONFIRMED" });

      const preparingResponsePromise = waitForItemsPatch(staffPage, createdOrderId);
      await staffOrder.getByRole("button", { name: "全部開始製作（1）", exact: true }).click();
      const preparingResponse = await preparingResponsePromise;
      expect(preparingResponse.status()).toBe(200);
      expect(preparingResponse.request().postDataJSON()).toEqual({ status: "PREPARING" });

      const readyResponsePromise = waitForItemsPatch(staffPage, createdOrderId);
      await staffOrder.getByRole("button", { name: "全部餐點完成（1）", exact: true }).click();
      const readyResponse = await readyResponsePromise;
      expect(readyResponse.status()).toBe(200);
      expect(readyResponse.request().postDataJSON()).toEqual({ status: "READY" });
      await expect(staffOrder.getByLabel("3 位數取餐碼")).toBeVisible();

      await staffOrder.getByRole("button", { name: "無法取得取餐碼", exact: true }).click();
      const manualPickupDialog = staffPage.getByRole("alertdialog", { name: "人工核對取餐" });
      await expect(manualPickupDialog).toContainText(`訂單 ${orderNo}`);
      await expect(manualPickupDialog.getByLabel("輸入完整訂單編號以確認")).toHaveCount(0);
      const confirmManualPickup = manualPickupDialog.getByRole("button", {
        name: "確認人工取餐",
        exact: true,
      });
      await expect(confirmManualPickup).toBeDisabled();
      await manualPickupDialog.getByLabel("已向顧客核對稱呼與全部餐點內容").check();

      const manualPickupResponsePromise = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith(`/orders/${createdOrderId}/verify-pickup`)
        && response.request().method() === "POST"
      ));
      await confirmManualPickup.click();
      const manualPickupResponse = await manualPickupResponsePromise;
      expect(manualPickupResponse.status()).toBe(200);
      expect(manualPickupResponse.request().postDataJSON()).toMatchObject({
        mode: "MANUAL",
        confirmationOrderNo: orderNo,
        confirmedCustomerDetails: true,
      });
      await expect(staffOrder).toContainText("已完成人工取餐核對");

      await staffOrder.getByRole("button", { name: "代結帳", exact: true }).first().click();
      const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
      await checkout.getByRole("button", { name: "現金", exact: true }).click();
      await checkout.getByRole("button", { name: "剛好", exact: true }).click();
      await expect(checkout.getByLabel("客戶實收金額")).toHaveValue(String(createdOrder.total));

      const checkoutResponsePromise = waitForOrderPatch(staffPage, createdOrderId);
      await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
      const checkoutResponse = await checkoutResponsePromise;
      expect(checkoutResponse.status()).toBe(200);
      expect(checkoutResponse.request().postDataJSON()).toMatchObject({
        status: "COMPLETED",
        paymentOptionId: cashPaymentOptionId,
        cashReceived: createdOrder.total,
      });
      await expect(staffOrder).toHaveCount(0);

      const completedOrder = await prisma.order.findUniqueOrThrow({
        where: { id: createdOrderId },
        include: { payment: true, items: true },
      });
      createdPaymentId = completedOrder.payment?.id ?? "";
      expect(completedOrder).toMatchObject({
        source: "QR_MENU",
        origin: "ONLINE_QR",
        fulfillmentType: "TAKEOUT",
        status: "COMPLETED",
        paymentStatus: "PAID",
        pickupVerificationMethod: "MANUAL",
      });
      expect(completedOrder.pickupVerifiedAt).not.toBeNull();
      expect(completedOrder.items).toHaveLength(1);
      expect(completedOrder.items[0]?.status).toBe("READY");
      expect(completedOrder.payment).toMatchObject({
        id: createdPaymentId,
        paymentOptionId: cashPaymentOptionId,
        cashShiftId: activeCashShiftId,
        amount: createdOrder.total,
        method: "CASH",
        methodLabel: "現金",
        status: "PAID",
        cashReceived: createdOrder.total,
        changeAmount: 0,
      });
    } finally {
      await staffContext.close();
    }
  });
});

function waitForOrderPatch(page: Page, orderId: string) {
  return page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/orders/${orderId}`)
    && response.request().method() === "PATCH"
  ));
}

function waitForItemsPatch(page: Page, orderId: string) {
  return page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/orders/${orderId}/items`)
    && response.request().method() === "PATCH"
  ));
}

async function resolveCreatedRecordIds() {
  if (!createdOrderId) {
    createdOrderId = (await prisma.order.findFirst({
      where: { stallId, customerName: testMarker },
      select: { id: true },
    }))?.id ?? "";
  }
  if (!createdSessionId && createdOrderId) {
    createdSessionId = (await prisma.orderSession.findUnique({
      where: { orderId: createdOrderId },
      select: { id: true },
    }))?.id ?? "";
  }
  if (!createdPaymentId && createdOrderId) {
    createdPaymentId = (await prisma.payment.findUnique({
      where: { orderId: createdOrderId },
      select: { id: true },
    }))?.id ?? "";
  }
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("staff@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  const loginResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/staff\//, { timeout: 30_000 });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 測試需要設定 DATABASE_URL。");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕對非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(
      process.env.STALLORDER_E2E_ENV_FILE ?? resolve(process.cwd(), ".env"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.replace(/^(["'])(.*)\1$/u, "$2");
  }
}
