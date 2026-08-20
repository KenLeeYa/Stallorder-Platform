import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const stallName = "阿明鹽酥雞";
const productName = "香酥雞排";
const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";
const password = "StallOrderDemo!2026";
const mobileViewport = { width: 390, height: 844 };
const customerName = `Phase 0-3 手機旅程 ${Date.now()}-${randomUUID().slice(0, 8)}`;

let productId = "";
let createdOrderId = "";
let createdSessionId = "";

test.describe("Phase 0-3 跨角色手機旅程", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [stall, qrCode, stallProduct, station] = await Promise.all([
      prisma.stall.findUniqueOrThrow({
        where: { id: stallId },
        select: {
          organizationId: true,
          slug: true,
          isActive: true,
          businessStatus: true,
          orderingEnabled: true,
          orderingState: true,
          isSoldOut: true,
        },
      }),
      prisma.qrCode.findUniqueOrThrow({
        where: { token: takeoutQrToken },
        select: {
          organizationId: true,
          stallId: true,
          state: true,
          expiresAt: true,
          fulfillmentTypeContext: true,
        },
      }),
      prisma.stallProduct.findFirstOrThrow({
        where: {
          organizationId,
          stallId,
          isEnabled: true,
          isSoldOut: false,
          product: {
            name: productName,
            isActive: true,
            category: { isActive: true },
          },
        },
        select: { productId: true },
      }),
      prisma.kitchenStation.findFirstOrThrow({
        where: { organizationId, stallId, isActive: true },
        select: { id: true },
      }),
    ]);

    expect(stall).toMatchObject({
      organizationId,
      slug: stallSlug,
      isActive: true,
      businessStatus: "OPEN",
      orderingEnabled: true,
      orderingState: "OPEN",
      isSoldOut: false,
    });
    expect(qrCode).toMatchObject({
      organizationId,
      stallId,
      state: "ACTIVE",
    });
    expect(qrCode.expiresAt === null || qrCode.expiresAt.getTime() > Date.now()).toBe(true);
    expect(qrCode.fulfillmentTypeContext === null || qrCode.fulfillmentTypeContext === "TAKEOUT")
      .toBe(true);
    expect(station.id).not.toBe("");
    productId = stallProduct.productId;
  });

  test.afterAll(async () => {
    try {
      await resolveCreatedRecords();
      if (createdSessionId) {
        await prisma.publicOrderAttempt.deleteMany({
          where: { orderSessionId: createdSessionId },
        });
        await prisma.orderSession.deleteMany({ where: { id: createdSessionId } });
      }
      if (createdOrderId) {
        await prisma.order.deleteMany({ where: { id: createdOrderId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("商家到 Tracker 以同一張外帶單驗證手機 CTA、角色與狀態", async ({ browser, page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(mobileViewport);

    const merchantContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: mobileViewport,
    });
    try {
      const merchantPage = await merchantContext.newPage();
      await login(merchantPage, "owner@stallorder.test");
      await merchantPage.goto(`/merchant/${stallSlug}`);
      await expect(merchantPage).toHaveURL(new RegExp(`/merchant/${stallSlug}$`, "u"));
      await expect(merchantPage.getByRole("heading", { name: stallName, exact: true })).toBeVisible();
      await expectInitiallyInViewport(merchantPage.getByText("開放點餐", { exact: true }));
      await expectInitiallyInViewport(merchantPage.getByText("可供應", { exact: true }));
      await expectInitiallyInViewport(merchantPage.getByText("QR 啟用中", { exact: true }));
      await expect(merchantPage.getByText(/顧客點餐 QR Code/u)).toBeVisible();

      const expandMerchantOptions = merchantPage.getByRole("button", { name: "展開商戶選項" });
      await expectInitiallyInViewport(expandMerchantOptions);
      await expandMerchantOptions.click();
      const workMode = merchantPage.getByLabel("切換工作模式");
      await expect(workMode).toHaveValue(`merchant:${organizationId}`);
      await expectInitiallyInViewport(workMode);
      await expectNoHorizontalOverflow(merchantPage);
    } finally {
      await merchantContext.close();
    }

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

    await expect(page).toHaveURL(new RegExp(`/q/${takeoutQrToken}$`, "u"));
    const product = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: productName, exact: true }),
    });
    await expect(product).toBeVisible();
    await product.getByRole("button", { name: `增加 ${productName}` }).click();
    await product.getByRole("button", { name: "加入購物車", exact: true }).click();

    const mobileCartSummary = page.getByTestId("qr-mobile-cart-summary");
    await expectInitiallyInViewport(mobileCartSummary);
    await expectNoHorizontalOverflow(page);
    await mobileCartSummary.click();
    const cart = page.getByTestId("qr-cart-panel");
    await expect(cart).toHaveAttribute("role", "dialog");
    await expect(cart.getByTestId("qr-cart-line")).toHaveCount(1);
    await expect(cart).toContainText(productName);
    await page.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
    await page.getByLabel("顧客稱呼").fill(customerName);
    const waitAcknowledgment = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/u });
    if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

    let createOrderResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-public-order")
      && response.request().method() === "POST"
    ));
    const submitOrder = page.getByRole("button", { name: "送出訂單", exact: true });
    await expectActionInViewport(submitOrder);
    await expect(submitOrder).toBeEnabled({ timeout: 20_000 });
    await submitOrder.click();
    let createOrderResponse = await createOrderResponsePromise;
    if (createOrderResponse.status() === 422) {
      await expect(createOrderResponse.json()).resolves.toMatchObject({ code: "WAIT_ACKNOWLEDGMENT_REQUIRED" });
      await expect(waitAcknowledgment).toBeVisible();
      await waitAcknowledgment.check();
      await expect(submitOrder).toBeEnabled({ timeout: 20_000 });
      createOrderResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith("/create-public-order")
        && response.request().method() === "POST"
      ));
      await submitOrder.click();
      createOrderResponse = await createOrderResponsePromise;
    }
    expect(createOrderResponse.status()).toBe(201);
    const createOrderRequest = createOrderResponse.request().postDataJSON() as {
      clientOrderId?: string;
      qrToken?: string;
      customerName?: string;
      items?: Array<{ productId?: string; quantity?: number }>;
    };
    expect(createOrderRequest).toMatchObject({
      qrToken: takeoutQrToken,
      customerName,
      items: [{ productId, quantity: 1 }],
    });
    const clientOrderId = createOrderRequest.clientOrderId;
    expect(clientOrderId).toEqual(expect.any(String));
    if (!clientOrderId) throw new Error("create-public-order request 缺少 clientOrderId");

    await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+$/u);
    const trackingToken = decodeURIComponent(
      new URL(page.url()).pathname.replace(/^\/order\//u, ""),
    );
    expect(trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/u);
    const trackingTokenHash = createHash("sha256").update(trackingToken).digest("hex");

    const createdOrder = await prisma.order.findUniqueOrThrow({
      where: { id: clientOrderId },
      select: {
        id: true,
        orderNo: true,
        trackingTokenHash: true,
        customerName: true,
        fulfillmentType: true,
        status: true,
        source: true,
        origin: true,
        orderSession: { select: { id: true } },
        items: { select: { productId: true, name: true, quantity: true, status: true } },
      },
    });
    createdOrderId = createdOrder.id;
    const orderNo = createdOrder.orderNo;
    expect(createdOrder).toMatchObject({
      id: clientOrderId,
      orderNo,
      trackingTokenHash,
      customerName,
      fulfillmentType: "TAKEOUT",
      status: "WAITING_CONFIRMATION",
      source: "QR_MENU",
      origin: "ONLINE_QR",
      orderSession: { id: createdSessionId },
      items: [{ productId, name: productName, quantity: 1, status: "PENDING" }],
    });

    await expect(page.getByText(`訂單 ${orderNo}`, { exact: true })).toBeVisible();
    await expect(page.getByText("等待攤位確認", { exact: true })).toBeVisible();
    await expect(page.getByText(productName, { exact: false })).toBeVisible();
    await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/u);
    const trackerRefresh = page.getByRole("button", { name: "重新整理訂單" });
    await expectInitiallyInViewport(trackerRefresh);
    await expectNoHorizontalOverflow(page);

    const staffContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: mobileViewport,
    });
    try {
      const staffPage = await staffContext.newPage();
      await login(staffPage, "staff@stallorder.test");
      await staffPage.goto(`/staff/${stallSlug}`);
      await expect(staffPage).toHaveURL(new RegExp(`/staff/${stallSlug}$`, "u"));
      await expect(staffPage.getByRole("heading", { name: stallName, exact: true })).toBeVisible();
      await staffPage.getByRole("searchbox", { name: "搜尋桌號或訂單編號" }).fill(customerName);
      const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
      await expect(staffOrder).toBeVisible();
      await expect(staffOrder).toContainText(`訂單 ${orderNo}`);
      await expect(staffOrder).toContainText("外帶");
      await expect(staffOrder).toContainText(productName);
      const confirmOrder = staffOrder.getByRole("button", { name: "確認接單", exact: true });
      await expectActionInViewport(confirmOrder);
      await expectNoHorizontalOverflow(staffPage);

      const confirmResponsePromise = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith(`/orders/${createdOrderId}`)
        && response.request().method() === "PATCH"
      ));
      await confirmOrder.click();
      const confirmResponse = await confirmResponsePromise;
      expect(confirmResponse.status()).toBe(200);
      expect(confirmResponse.request().postDataJSON()).toMatchObject({ status: "CONFIRMED" });
      await expect(staffOrder).toContainText("待製作");
      await expect(confirmOrder).toHaveCount(0);

      await expect.poll(async () => prisma.order.findUnique({
        where: { id: createdOrderId },
        select: {
          status: true,
          productionTasks: {
            select: {
              orderId: true,
              status: true,
              orderItem: { select: { productId: true, name: true, status: true } },
              station: { select: { isActive: true } },
            },
          },
        },
      })).toMatchObject({
        status: "CONFIRMED",
        productionTasks: [{
          orderId: createdOrderId,
          status: "PENDING",
          orderItem: { productId, name: productName, status: "PENDING" },
          station: { isActive: true },
        }],
      });

      const kitchenContext = await browser.newContext({
        locale: "zh-TW",
        timezoneId: "Asia/Taipei",
        viewport: mobileViewport,
      });
      try {
        const kitchenPage = await kitchenContext.newPage();
        await login(kitchenPage, "kitchen@stallorder.test");
        await kitchenPage.goto(`/kitchen?stall=${stallSlug}`);
        await expect(kitchenPage).toHaveURL(new RegExp(`/kitchen\\?stall=${stallSlug}$`, "u"));
        await expect(kitchenPage.getByRole("heading", { name: "廚房生產系統" })).toBeVisible();
        const kitchenOrder = kitchenPage.getByRole("article").filter({ hasText: `#${orderNo}` });
        await expect(kitchenOrder).toBeVisible();
        await expect(kitchenOrder).toContainText("外帶自取 · QR 點餐");
        await expect(kitchenOrder).toContainText(productName);
        const startPreparation = kitchenOrder
          .getByRole("button", { name: "開始製作", exact: true })
          .first();
        await expectActionInViewport(startPreparation);
        await expectNoHorizontalOverflow(kitchenPage);
        await waitForReactHydration(startPreparation);
        await startPreparation.click();
        await expect(kitchenOrder.getByText("製作中", { exact: true }).first()).toBeVisible();

        await expect.poll(async () => prisma.order.findUnique({
          where: { id: createdOrderId },
          select: {
            status: true,
            items: { select: { productId: true, name: true, status: true } },
            productionTasks: { select: { status: true, orderItemId: true, startedAt: true } },
          },
        })).toMatchObject({
          status: "PREPARING",
          items: [{ productId, name: productName, status: "PREPARING" }],
          productionTasks: [{ status: "PREPARING", startedAt: expect.any(Date) }],
        });
      } finally {
        await kitchenContext.close();
      }

      const staffRefresh = staffPage.getByTitle("重新整理").first();
      await staffRefresh.click();
      await expect(staffOrder).toContainText("製作中");
      await expect(staffOrder).toContainText(`訂單 ${orderNo}`);
      await expectNoHorizontalOverflow(staffPage);
    } finally {
      await staffContext.close();
    }

    await trackerRefresh.click();
    await expect(page.getByText("製作中", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`訂單 ${orderNo}`, { exact: true })).toBeVisible();
    await expect(page.getByText(productName, { exact: false })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/order/${trackingToken}$`, "u"));
    await expectInitiallyInViewport(trackerRefresh);
    await expectNoHorizontalOverflow(page);
  });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  const emailLoginButton = page.getByRole("button", {
    name: "使用電子郵件與密碼登入",
    exact: true,
  });
  await waitForReactHydration(emailLoginButton);
  await emailLoginButton.click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const loginResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=|\/staff\/|\/kitchen\?/u, {
    timeout: 30_000,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.viewport).toBe(mobileViewport.width);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
}

async function expectInitiallyInViewport(target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
}

async function expectActionInViewport(target: Locator) {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
}

async function waitForReactHydration(control: Locator) {
  await expect.poll(() => control.evaluate((element) => (
    Object.keys(element).some((key) => (
      key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
    ))
  )), { message: "等待 React 完成控制項 hydration" }).toBe(true);
}

async function resolveCreatedRecords() {
  if (!createdOrderId) {
    createdOrderId = (await prisma.order.findFirst({
      where: { stallId, customerName },
      select: { id: true },
    }))?.id ?? "";
  }
  if (!createdSessionId && createdOrderId) {
    createdSessionId = (await prisma.orderSession.findUnique({
      where: { orderId: createdOrderId },
      select: { id: true },
    }))?.id ?? "";
  }
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
