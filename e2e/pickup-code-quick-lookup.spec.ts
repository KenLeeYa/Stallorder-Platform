import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  dismissStaffStartReminder,
  qrProductSelectionControl,
} from "./local-navigation";

const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)
) {
  throw new Error("此測試僅允許連線本機資料庫。");
}

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const qrToken = `pickup-code-e2e-${randomUUID()}`;
const password = "StallOrderDemo!2026";
type CreatedOrder = {
  id: string;
  orderNo: string;
  pickupCode: string;
  sessionId: string;
};

const createdOrders: CreatedOrder[] = [];
let originalStall: {
  businessStatus: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  orderingEnabled: boolean;
  orderingState: "OPEN" | "PAUSED" | "CLOSED";
  isActive: boolean;
  isSoldOut: boolean;
} | null = null;
let originalHours: Array<{
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}> = [];
let fixtureQrId = "";

test.describe("每日三碼取餐與店員快速載單", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [stall, hours, qrVersion] = await Promise.all([
      prisma.stall.findUniqueOrThrow({
        where: { id: stallId },
        select: {
          businessStatus: true,
          orderingEnabled: true,
          orderingState: true,
          isActive: true,
          isSoldOut: true,
        },
      }),
      prisma.stallBusinessHour.findMany({
        where: { organizationId, stallId },
        orderBy: { dayOfWeek: "asc" },
        select: { id: true, opensAt: true, closesAt: true, isClosed: true },
      }),
      prisma.qrCode.aggregate({
        where: { stallId },
        _max: { tokenVersion: true },
      }),
    ]);
    expect(hours).toHaveLength(7);
    originalStall = stall;
    originalHours = hours;

    await prisma.$transaction([
      prisma.stall.update({
        where: { id: stallId },
        data: {
          businessStatus: "OPEN",
          orderingEnabled: true,
          orderingState: "OPEN",
          isActive: true,
          isSoldOut: false,
        },
      }),
      prisma.stallBusinessHour.updateMany({
        where: { organizationId, stallId },
        data: { opensAt: "00:00", closesAt: "23:59", isClosed: false },
      }),
    ]);
    fixtureQrId = (
      await prisma.qrCode.create({
        data: {
          organizationId,
          stallId,
          token: qrToken,
          label: "Pickup code E2E",
          state: "ACTIVE",
          tokenVersion: (qrVersion._max.tokenVersion ?? 0) + 1,
        },
        select: { id: true },
      })
    ).id;
  });

  test.afterAll(async () => {
    try {
      for (const order of createdOrders) {
        await prisma.publicOrderAttempt.deleteMany({
          where: { orderSessionId: order.sessionId },
        });
        await prisma.orderSession.deleteMany({
          where: { id: order.sessionId },
        });
        await prisma.payment.deleteMany({ where: { orderId: order.id } });
        await prisma.order.deleteMany({ where: { id: order.id } });
      }
    } finally {
      try {
        if (originalStall) {
          await prisma.stall.update({
            where: { id: stallId },
            data: originalStall,
          });
        }
        await Promise.all(
          originalHours.map((hour) =>
            prisma.stallBusinessHour.update({
              where: { id: hour.id },
              data: {
                opensAt: hour.opensAt,
                closesAt: hour.closesAt,
                isClosed: hour.isClosed,
              },
            }),
          ),
        );
        if (fixtureQrId) {
          await prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId: fixtureQrId } });
          await prisma.qrCode.deleteMany({ where: { id: fixtureQrId } });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  test("在線訂單不重複，終止後號碼可回收，店員可直接載入結帳", async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const publicOrderClientIp = `203.0.113.${180 + testInfo.retry + testInfo.repeatEachIndex * 4}`;

    const first = await test.step("建立第一筆外帶訂單", () =>
      placeTakeoutOrder(browser, publicOrderClientIp));
    const second = await test.step("建立第二筆外帶訂單", () =>
      placeTakeoutOrder(browser, publicOrderClientIp));
    createdOrders.push(first, second);

    expect(first.pickupCode).toMatch(/^\d{3}$/u);
    expect(second.pickupCode).toMatch(/^\d{3}$/u);
    expect(second.pickupCode).not.toBe(first.pickupCode);

    await prisma.order.update({
      where: { id: first.id },
      data: { status: "EXPIRED", expiredAt: new Date() },
    });

    const recycled = await test.step("建立取餐碼回收驗證訂單", () =>
      placeTakeoutOrder(browser, publicOrderClientIp));
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

    await page.setViewportSize({ width: 390, height: 844 });
    await test.step("店員以取餐碼載入完成訂單", async () => {
      await loginAsStaff(page);
      await dismissStaffStartReminder(page);
      const pickupLookupButton = await stablePickupLookupButton(page);
      await pickupLookupButton.click();

      const lookupDialog = page.getByRole("dialog", {
        name: "以取餐碼載入訂單",
      });
      await lookupDialog.getByLabel("取餐驗證碼").fill(recycled.pickupCode);
      const lookupResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith("/orders/pickup-code") &&
          response.request().method() === "POST",
      );
      await lookupDialog
        .getByRole("button", { name: "驗證並處理訂單", exact: true })
        .click();
      expect((await lookupResponse).status()).toBe(200);

      await expect(
        page.getByRole("dialog", { name: "結帳收款" }),
      ).toBeVisible();
    });
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
  });
});

async function placeTakeoutOrder(
  browser: Browser,
  clientIp: string,
): Promise<CreatedOrder> {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "cf-connecting-ip": clientIp,
      "x-vercel-forwarded-for": clientIp,
    },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    const sessionResponse = page.waitForResponse(
      (response) =>
        ["/create-order-session", "/api/public/order-session"].some((path) =>
          new URL(response.url()).pathname.endsWith(path),
        ) && response.request().method() === "POST",
    );
    await page.goto(`/q/${qrToken}`);
    const sessionPayload = (await (await sessionResponse).json()) as {
      orderSessionToken: string;
    };

    const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
    const selectProduct = qrProductSelectionControl(product, "香酥雞排");
    await expect(selectProduct).toBeEnabled({ timeout: 20_000 });
    await selectProduct.click();
    const addToCart = product.getByRole("button", {
      name: "加入購物車",
      exact: true,
    });
    await expect(addToCart).toBeEnabled();
    await addToCart.click();
    const mobileCartSummary = page.getByTestId("qr-mobile-cart-summary");
    await expect(mobileCartSummary).toBeVisible();
    await mobileCartSummary.click();
    const cart = page.getByTestId("qr-cart-panel");
    await cart
      .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
      .click();
    await expect(page.getByLabel("顧客稱呼")).toHaveCount(0);
    await expect(page.getByLabel("聯絡電話")).toHaveCount(0);
    await expect(page.getByLabel("訂單備註")).toBeVisible();
    const waitAcknowledgment = page.getByRole("checkbox", {
      name: /我已了解目前預估等候時間/u,
    });
    if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

    const submit = page.getByRole("button", { name: "送出訂單", exact: true });
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    const orderResponse = page.waitForResponse(
      (response) =>
        ["/create-public-order", "/api/public/orders"].some((path) =>
          new URL(response.url()).pathname.endsWith(path),
        ) && response.request().method() === "POST",
    );
    await submit.click();
    expect((await orderResponse).status()).toBe(201);
    await expect(page).toHaveURL(/\/order\//u);

    const pickupCode =
      (await page.getByTestId("pickup-code").textContent())?.trim() ?? "";
    const orderNo =
      (await page.getByText(/^訂單 /u).textContent())?.replace(
        /^訂單\s*/u,
        "",
      ) ?? "";
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
  await page
    .getByRole("button", { name: "使用電子郵件與密碼登入", exact: true })
    .click();
  await page.getByLabel("電子郵件").fill("staff@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\//u, { timeout: 30_000 });
}

async function stablePickupLookupButton(page: Page) {
  const header = page.getByTestId("staff-sticky-header");
  const pickupLookupButton = page.getByTestId("staff-pickup-code-lookup");
  await expect(async () => {
    await expect(header).toHaveCount(1);
    await expect(pickupLookupButton).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(header).toHaveCount(1);
    await expect(pickupLookupButton).toHaveCount(1);
  }).toPass({ timeout: 10_000 });
  return pickupLookupButton;
}
