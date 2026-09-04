import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  dismissStaffStartReminder,
  qrProductSelectionControl,
} from "./local-navigation";
import { createOpenQrFixture } from "./open-qr-fixture";

test.use({ serviceWorkers: "block" });

const prisma = new PrismaClient();
let takeoutQrToken = "";
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

let qrFixture: Awaited<
  ReturnType<typeof createOpenQrFixture>
> | null = null;

test.beforeAll(async () => {
  qrFixture = await createOpenQrFixture({
    organizationId,
    stallId,
    tokenPrefix: "e2e-qr-order-recovery",
    label: "E2E QR 訂單找回",
  });
  takeoutQrToken = qrFixture.qrToken;
});

test.afterAll(async () => {
  try {
    if (qrFixture) {
      const sessions = await prisma.orderSession.findMany({
        where: { qrCodeId: qrFixture.qrCodeId, orderId: { not: null } },
        select: { orderId: true },
      });
      const orderIds = sessions.flatMap((session) =>
        session.orderId ? [session.orderId] : []
      );
      if (orderIds.length > 0) {
        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
    }
  } finally {
    try {
      await qrFixture?.restore();
    } finally {
      await prisma.$disconnect();
    }
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  const origin = new URL(page.url()).origin;
  const loginResponse = await page.context().request.post("/api/auth/login", {
    data: { email, password },
    headers: {
      origin,
      referer: page.url(),
      "sec-fetch-site": "same-origin",
    },
  });
  expect(loginResponse.status()).toBe(200);
  const body = await loginResponse.json() as { next?: string };
  await page.goto(body.next ?? "/");
  await expect(page).toHaveURL(
    /\/merchant\/dashboard\?organizationId=|\/staff\//,
  );
}

test("重掃同一 QR 找回原訂單，遺失三位數取餐碼時可人工核對", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": "203.0.113.103" });
  await page.goto(`/q/${takeoutQrToken}`);
  await page.getByRole("button", { name: "點餐語言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  const chickenCutlet = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Deep-Fried Chicken Cutlet",
      exact: true,
    }),
  });
  await qrProductSelectionControl(
    chickenCutlet,
    "Deep-Fried Chicken Cutlet",
    "Increase Deep-Fried Chicken Cutlet",
  ).click();
  await chickenCutlet
    .getByRole("button", { name: "Add to cart", exact: true })
    .click();
  await expect(page.getByLabel("Customer name")).toHaveCount(0);
  await expect(page.getByLabel("Phone", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Order notes", { exact: true })).toBeVisible();
  const waitAcknowledgment = page.getByRole("checkbox", {
    name: /I understand the estimated wait/,
  });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
  const submitOrder = page.getByRole("button", {
    name: "Place order",
    exact: true,
  });
  await expect(submitOrder).toBeEnabled({ timeout: 15_000 });

  let createResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/create-public-order") &&
      response.request().method() === "POST",
  );
  await submitOrder.click();
  let createResponse = await createResponsePromise;
  if (createResponse.status() === 422) {
    await expect(createResponse.json()).resolves.toMatchObject({
      code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
    });
    await expect(waitAcknowledgment).toBeVisible();
    await waitAcknowledgment.check();
    await expect(submitOrder).toBeEnabled({ timeout: 15_000 });
    createResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/create-public-order") &&
        response.request().method() === "POST",
    );
    await submitOrder.click();
    createResponse = await createResponsePromise;
  }
  expect(createResponse.status()).toBe(201);
  expect(createResponse.request().postDataJSON()).toMatchObject({
    customerName: "",
    customerPhone: "",
  });
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);
  const orderNumberText = await page.getByText(/^訂單 /).textContent();
  const orderNo = orderNumberText?.replace(/^訂單\s*/, "") ?? "";
  expect(orderNo).not.toBe("");
  const createdOrder = await prisma.order.findUniqueOrThrow({
    where: { stallId_orderNo: { stallId, orderNo } },
    select: { id: true },
  });
  const trackingPath = new URL(page.url()).pathname;
  const trackingToken = trackingPath.replace(/^\/order\//u, "");

  const resumeSessionRequests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.endsWith("/create-order-session") &&
      request.method() === "POST"
    )
      resumeSessionRequests.push(request.url());
  });
  const recoveryValidationResponse = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    const method = response.request().method();
    return (
      (pathname.endsWith("/get-public-order") && method === "POST") ||
      (pathname.endsWith(`/api/public/orders/${trackingToken}`) &&
        method === "GET")
    );
  });
  await page.goto(`/q/${takeoutQrToken}`);
  expect((await recoveryValidationResponse).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).pathname).toBe(trackingPath);
  expect(resumeSessionRequests).toHaveLength(0);
  await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);

  const staffContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
  });
  try {
    const staffPage = await staffContext.newPage();
    await login(staffPage, "staff@stallorder.test");
    await staffPage.goto("/staff/aming-chicken");
    await dismissStaffStartReminder(staffPage);
    const staffOrder = staffPage
      .getByRole("article")
      .filter({ hasText: orderNo });
    await staffOrder
      .getByRole("button", { name: "查看明細", exact: true })
      .click();
    await staffOrder
      .getByRole("button", { name: "確認接單", exact: true })
      .click();
    await staffOrder
      .getByRole("button", { name: "全部開始製作（1）", exact: true })
      .click();
    await staffOrder
      .getByRole("button", { name: "全部餐點完成（1）", exact: true })
      .click();
    await staffOrder
      .getByRole("button", { name: "結帳收款", exact: true })
      .click();
    const paymentDialog = staffPage.getByRole("dialog", {
      name: "結帳收款",
    });
    await paymentDialog
      .getByRole("button", { name: "LINE Pay", exact: true })
      .click();
    const paymentResponsePromise = staffPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          `/orders/${createdOrder.id}`,
        ) && response.request().method() === "PATCH",
    );
    await paymentDialog
      .getByRole("button", { name: "確認收款", exact: true })
      .click();
    const paymentResponse = await paymentResponsePromise;
    expect(paymentResponse.status()).toBe(200);
    expect(paymentResponse.request().postDataJSON()).toMatchObject({
      status: "COMPLETED",
      completionIntent: "COLLECT_PAYMENT",
    });
    await expect(paymentResponse.json()).resolves.toMatchObject({
      completionPendingFulfillment: true,
      order: { status: "READY", paymentStatus: "PAID" },
    });
    await expect(staffOrder).toContainText("已付款");
    await staffOrder
      .getByRole("button", { name: "完成訂單", exact: true })
      .click();
    const pickupCheckout = staffPage.getByRole("dialog", {
      name: "驗證取餐碼並完成訂單",
    });
    await expect(pickupCheckout.getByLabel("3 位數取餐碼")).toBeVisible();
    await pickupCheckout
      .getByRole("button", { name: "無法取得取餐碼" })
      .click();

    const manualDialog = staffPage.getByRole("alertdialog", {
      name: "人工核對取餐",
    });
    await expect(manualDialog).toContainText(`訂單 ${orderNo}`);
    await expect(manualDialog.getByLabel("輸入完整訂單編號以確認")).toHaveCount(
      0,
    );
    const confirmManualPickup = manualDialog.getByRole("button", {
      name: "確認人工取餐",
    });
    await expect(confirmManualPickup).toBeDisabled();
    await manualDialog.getByLabel("已向顧客核對稱呼與全部餐點內容").check();
    await expect(confirmManualPickup).toBeEnabled();
    const manualPickupResponsePromise = staffPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          `/orders/${createdOrder.id}/verify-pickup`,
        ) && response.request().method() === "POST",
    );
    const completionResponsePromise = staffPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          `/orders/${createdOrder.id}`,
        ) && response.request().method() === "PATCH",
    );
    await confirmManualPickup.click();
    const manualPickupResponse = await manualPickupResponsePromise;
    expect(manualPickupResponse.status()).toBe(200);
    expect(manualPickupResponse.request().postDataJSON()).toMatchObject({
      mode: "MANUAL",
      confirmationOrderNo: orderNo,
      confirmedCustomerDetails: true,
    });
    const completionResponse = await completionResponsePromise;
    expect(completionResponse.status()).toBe(200);
    expect(completionResponse.request().postDataJSON()).toEqual({
      status: "COMPLETED",
      completionIntent: "FINALIZE",
    });
    await expect(staffOrder).toHaveCount(0);
  } finally {
    await staffContext.close();
  }
});
