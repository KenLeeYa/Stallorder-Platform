import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("此測試僅允許連線本機資料庫。");
}

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const qrToken = "demo-aming-chicken-qr-2026-rotate-me";
const password = "StallOrderDemo!2026";
const runMarker = `每日取餐碼 E2E ${Date.now()}-${randomUUID().slice(0, 8)}`;

type CreatedOrder = {
  id: string;
  orderNo: string;
  pickupCode: string;
  sessionId: string;
};

const createdOrders: CreatedOrder[] = [];

test.describe("每日三碼取餐與店員快速載單", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    try {
      for (const order of createdOrders) {
        await prisma.publicOrderAttempt.deleteMany({ where: { orderSessionId: order.sessionId } });
        await prisma.orderSession.deleteMany({ where: { id: order.sessionId } });
        await prisma.payment.deleteMany({ where: { orderId: order.id } });
        await prisma.order.deleteMany({ where: { id: order.id } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("在線訂單不重複，終止後號碼可回收，店員可直接載入結帳", async ({ browser }) => {
    test.setTimeout(180_000);

    const first = await placeTakeoutOrder(browser, `${runMarker}-A`);
    const second = await placeTakeoutOrder(browser, `${runMarker}-B`);
    createdOrders.push(first, second);

    expect(first.pickupCode).toMatch(/^\d{3}$/u);
    expect(second.pickupCode).toMatch(/^\d{3}$/u);
    expect(second.pickupCode).not.toBe(first.pickupCode);

    await prisma.order.update({
      where: { id: first.id },
      data: { status: "EXPIRED", expiredAt: new Date() },
    });

    const recycled = await placeTakeoutOrder(browser, `${runMarker}-C`);
    createdOrders.push(recycled);
    expect(recycled.pickupCode).toBe(first.pickupCode);

    const readyAt = new Date();
    await prisma.$transaction([
      prisma.order.update({
        where: { id: recycled.id },
        data: { status: "READY", confirmedAt: readyAt },
      }),
      prisma.orderItem.updateMany({
        where: { orderId: recycled.id },
        data: { status: "READY" },
      }),
    ]);

    const context = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: { width: 390, height: 844 },
    });
    try {
      const staffPage = await context.newPage();
      await loginAsStaff(staffPage);
      const pickupLookupButton = staffPage.getByTestId("staff-pickup-code-lookup");
      await expect(pickupLookupButton).toHaveCount(1);
      await pickupLookupButton.click();

      const lookupDialog = staffPage.getByRole("dialog", { name: "以取餐碼載入訂單" });
      await lookupDialog.getByLabel("取餐驗證碼").fill(recycled.pickupCode);
      const lookupResponse = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith("/orders/pickup-code")
        && response.request().method() === "POST"
      ));
      await lookupDialog.getByRole("button", { name: "載入並開啟結帳", exact: true }).click();
      expect((await lookupResponse).status()).toBe(200);

      await expect(staffPage.getByRole("dialog", { name: "完成訂單" })).toBeVisible();
      const verified = await prisma.order.findUniqueOrThrow({
        where: { id: recycled.id },
        select: {
          pickupVerifiedAt: true,
          pickupVerificationMethod: true,
          status: true,
          paymentStatus: true,
        },
      });
      expect(verified.pickupVerifiedAt).not.toBeNull();
      expect(verified.pickupVerificationMethod).toBe("CODE");
      expect(verified.status).toBe("READY");
      expect(verified.paymentStatus).toBe("UNPAID");
    } finally {
      await context.close();
    }
  });
});

async function placeTakeoutOrder(browser: Browser, customerName: string): Promise<CreatedOrder> {
  const context = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    const sessionResponse = page.waitForResponse((response) => (
      ["/create-order-session", "/api/public/order-session"].some((path) => (
        new URL(response.url()).pathname.endsWith(path)
      ))
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${qrToken}`);
    const sessionPayload = await (await sessionResponse).json() as { orderSessionToken: string };

    const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
    await product.getByRole("button", { name: "增加 香酥雞排" }).click();
    await product.getByRole("button", { name: "加入購物車", exact: true }).click();
    await page.getByTestId("qr-mobile-cart-summary").click();
    const cart = page.getByTestId("qr-cart-panel");
    await cart.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
    await page.getByLabel("顧客稱呼").fill(customerName);
    await page.getByLabel("聯絡電話").fill("0912345678");
    const waitAcknowledgment = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/u });
    if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

    const submit = page.getByRole("button", { name: "送出訂單", exact: true });
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    const orderResponse = page.waitForResponse((response) => (
      ["/create-public-order", "/api/public/orders"].some((path) => (
        new URL(response.url()).pathname.endsWith(path)
      ))
      && response.request().method() === "POST"
    ));
    await submit.click();
    expect((await orderResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/order\//u);

    const pickupCode = (await page.getByTestId("pickup-code").textContent())?.trim() ?? "";
    const orderNo = (await page.getByText(/^訂單 /u).textContent())?.replace(/^訂單\s*/u, "") ?? "";
    const order = await prisma.order.findUniqueOrThrow({
      where: { stallId_orderNo: { stallId, orderNo } },
      select: {
        id: true,
        pickupCodeDisplay: true,
        pickupCodeServiceDate: true,
        orderSession: { select: { id: true } },
      },
    });

    expect(order.pickupCodeDisplay).toBe(pickupCode);
    expect(order.pickupCodeServiceDate).not.toBeNull();
    expect(order.orderSession?.id).toEqual(expect.any(String));
    expect(sessionPayload.orderSessionToken).toEqual(expect.any(String));
    return {
      id: order.id,
      orderNo,
      pickupCode,
      sessionId: order.orderSession!.id,
    };
  } finally {
    await context.close();
  }
}

async function loginAsStaff(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("staff@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\//u, { timeout: 30_000 });
}
