import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { continueQrCheckout, dismissStaffStartReminder, qrProductSelectionControl } from "./local-navigation";
import { createResponsiveOrderFixture } from "./helpers/responsive-order-fixture";
import { readResponsiveBuildProvenance } from "../scripts/responsive-build-provenance.mjs";

test.use({ actionTimeout: 15_000, serviceWorkers: "block" });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/auth/login") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login$/);
}

async function rolePage(browser: Browser, width: number) {
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_APP_URL,
    viewport: { width, height: width === 390 ? 844 : 900 },
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    serviceWorkers: "block",
  });
  return { context, page: await context.newPage() };
}

test("RSP-Q01: one real order moves from customer phone through staff tablet, KDS and desktop", async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const build = readResponsiveBuildProvenance();
  const prisma = new PrismaClient();
  const customer = await rolePage(browser, 390);
  const staff = await rolePage(browser, 1024);
  const kitchen = await rolePage(browser, 1024);
  const desktop = await rolePage(browser, 1440);
  const startedAt = new Date().toISOString();
  let fixture: Awaited<ReturnType<typeof createResponsiveOrderFixture>> | undefined;
  let orderId = "";
  let orderNo = "";
  let orderSubmissionStatus = 0;
  const observed: Array<{ step: string; status: string; at: string }> = [];
  const edgeSessionStatuses: number[] = [];
  customer.page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/functions/v1/create-order-session"
      && response.request().method() === "POST") edgeSessionStatuses.push(response.status());
  });
  const observe = (step: string, status: string) => observed.push({ step, status, at: new Date().toISOString() });
  try {
    fixture = await createResponsiveOrderFixture(prisma);
    const productName = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
    await customer.page.goto(`/q/${fixture.qrToken}`);
    const product = customer.page.getByRole("article").filter({
      has: customer.page.getByRole("heading", { name: productName, exact: true }),
    });
    await expect(product).toBeVisible();
    await customer.page.screenshot({ path: testInfo.outputPath("before-customer-390.png"), fullPage: true });
    for (let copy = 0; copy < 2; copy++) {
      await qrProductSelectionControl(product, productName).click();
      await customer.page.getByRole("radio", { name: /QA 必選加料/ }).click();
      await customer.page.getByRole("checkbox", { name: /QA 可選加料/ }).click();
      await product.getByRole("button", { name: "加入購物車", exact: true }).click();
    }
    await customer.page.getByTestId("qr-mobile-cart-summary").click();
    await customer.page.getByTestId("qr-cart-panel")
      .getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
    await continueQrCheckout(customer.page);
    await expect(customer.page.getByTestId("qr-cart-panel")).toContainText("$130");
    const acknowledge = customer.page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
    if (await acknowledge.isVisible()) await acknowledge.check();
    const submitted = customer.page.waitForResponse((response) =>
      ["/functions/v1/create-public-order", "/api/public/orders"].includes(new URL(response.url()).pathname)
      && response.request().method() === "POST",
    );
    await customer.page.getByRole("button", { name: "送出訂單", exact: true }).click();
    const createdResponse = await submitted;
    expect(new URL(createdResponse.url()).pathname).toBe("/functions/v1/create-public-order");
    expect(edgeSessionStatuses).toContain(201);
    orderSubmissionStatus = createdResponse.status();
    if (createdResponse.status() !== 201) {
      const createdPayload = await createdResponse.json() as { code?: string };
      expect(createdResponse.status(), createdPayload.code ?? "public order response").toBe(201);
    }
    await expect(customer.page).toHaveURL(/\/order\/[^/]+$/);
    const trackingToken = new URL(customer.page.url()).pathname.slice("/order/".length);
    const order = await prisma.order.findUniqueOrThrow({
      where: { trackingTokenHash: createHash("sha256").update(trackingToken).digest("hex") },
      include: { items: true },
    });
    orderId = order.id;
    orderNo = order.orderNo;
    expect(order.total).toBe(fixture.baselineTotal);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(2);
    observe("customer checkout", order.status);
    await expect(customer.page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);
    await customer.page.screenshot({ path: testInfo.outputPath("before-tracker-390.png"), fullPage: true });

    await login(staff.page, "staff@stallorder.test");
    await staff.page.goto(`/staff/${fixture.stallSlug}`);
    await dismissStaffStartReminder(staff.page);
    const staffOrder = staff.page.getByTestId("staff-order-list-pane")
      .getByRole("button").filter({ hasText: orderNo });
    await expect(staffOrder).toBeVisible();
    await staffOrder.click();
    const actions = staff.page.getByTestId("staff-order-actions-pane").filter({ visible: true });
    await expect(actions).toContainText("$130");
    await staff.page.screenshot({ path: testInfo.outputPath("before-staff-1024.png"), fullPage: true });
    const confirmed = staff.page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/stalls/${fixture!.stallSlug}/orders/${orderId}`
      && response.request().method() === "PATCH",
    );
    await actions.getByRole("button", { name: "確認接單", exact: true }).click();
    expect((await confirmed).status()).toBe(200);
    await expect.poll(async () => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CONFIRMED");
    observe("staff confirmed", "CONFIRMED");

    await login(kitchen.page, "kitchen@stallorder.test");
    await kitchen.page.goto(`/kitchen?stall=${fixture.stallSlug}`);
    const kitchenOrder = kitchen.page.getByRole("article").filter({ hasText: `#${orderNo}` });
    await expect(kitchenOrder).toBeVisible();
    await kitchen.page.screenshot({ path: testInfo.outputPath("before-kitchen-1024.png"), fullPage: true });
    const taskPath = `/api/stalls/${fixture.stallSlug}/kitchen/tasks`;
    const started = kitchen.page.waitForResponse((response) =>
      new URL(response.url()).pathname === taskPath && response.request().method() === "PATCH",
    );
    await kitchenOrder.getByRole("button", { name: "開始製作", exact: true }).click();
    expect((await started).status()).toBe(200);
    await expect.poll(async () => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PREPARING");
    observe("KDS started", "PREPARING");
    const ready = kitchen.page.waitForResponse((response) =>
      new URL(response.url()).pathname === taskPath && response.request().method() === "PATCH",
    );
    await kitchen.page.getByTestId("kitchen-order-items-pane")
      .getByRole("button", { name: "完成品項", exact: true }).click();
    expect((await ready).status()).toBe(200);
    await expect.poll(async () => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("READY");
    observe("KDS ready", "READY");
    await expect(customer.page.getByText("可取餐", { exact: true })).toBeVisible();
    const pickupCode = (await customer.page.getByTestId("pickup-code").textContent())?.trim() ?? "";
    expect(pickupCode).toMatch(/^\d{3}$/);

    await login(desktop.page, "staff@stallorder.test");
    await desktop.page.goto(`/staff/${fixture.stallSlug}`);
    const desktopOrder = desktop.page.getByTestId("staff-order-list-pane")
      .getByRole("button").filter({ hasText: orderNo });
    await expect(desktopOrder).toBeVisible();
    await desktopOrder.click();
    await expect(desktop.page.getByTestId("staff-order-actions-pane")).toContainText("$130");
    await desktop.page.screenshot({ path: testInfo.outputPath("before-desktop-1440.png"), fullPage: true });

    await desktop.page.getByTestId("staff-order-actions-pane")
      .getByRole("button", { name: "結帳收款", exact: true }).click();
    const checkout = desktop.page.getByRole("dialog", { name: "結帳收款" });
    await checkout.getByTestId("cash-quick-amounts")
      .getByRole("button", { name: "500", exact: true }).click();
    const paid = desktop.page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/stalls/${fixture!.stallSlug}/orders/${orderId}`
      && response.request().method() === "PATCH",
    );
    await checkout.getByRole("button", { name: "確認收款", exact: true }).click();
    expect((await paid).status()).toBe(200);
    await expect(desktop.page.getByTestId("staff-order-actions-pane")).toContainText("已付款");
    await desktop.page.getByTestId("staff-order-actions-pane")
      .getByRole("button", { name: "完成訂單", exact: true }).click();
    const pickupDialog = desktop.page.getByRole("dialog", { name: "驗證取餐碼並完成訂單" });
    await expect(pickupDialog).toBeVisible();
    const completed = desktop.page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/stalls/${fixture!.stallSlug}/orders/${orderId}/verify-pickup`
      && response.request().method() === "POST",
    );
    await pickupDialog.getByLabel("3 位數取餐碼").fill(pickupCode);
    expect((await completed).status()).toBe(200);
    await expect.poll(async () => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("COMPLETED");
    observe("desktop staff handoff", "COMPLETED");
    await expect(customer.page.getByText("已完成", { exact: true })).toBeVisible();
    await customer.page.screenshot({ path: testInfo.outputPath("completed-tracker-390.png"), fullPage: true });

    const final = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(final.id).toBe(orderId);
    expect(final.status).toBe("COMPLETED");
    expect(final.total).toBe(130);
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(1);
    const events = await prisma.orderEvent.findMany({
      where: { orderId }, orderBy: { createdAt: "asc" }, select: { eventType: true, createdAt: true },
    });
    const receipt = JSON.stringify({
        build,
        startedAt, finishedAt: new Date().toISOString(), runId: fixture.runId,
        edgeSessionStatuses, edgeOrderStatus: orderSubmissionStatus,
        orderId, orderNo, total: final.total, quantity: order.items[0].quantity,
        observed, events: events.map((event) => ({ type: event.eventType, at: event.createdAt.toISOString() })),
      }, null, 2);
    await writeFile(testInfo.outputPath("same-order-receipt.json"), `${receipt}\n`);
    await testInfo.attach("same-order-receipt", { contentType: "application/json", body: receipt });
  } finally {
    await Promise.allSettled([customer.context.close(), staff.context.close(), kitchen.context.close(), desktop.context.close()]);
    await prisma.$disconnect();
  }
});
