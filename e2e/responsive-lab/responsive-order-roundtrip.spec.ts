import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { continueQrCheckout, dismissStaffStartReminder, qrProductSelectionControl } from "../local-navigation";
import { createResponsiveOrderFixture } from "../helpers/responsive-order-fixture";
import { waitForOwnedOrderRateWindow } from "../helpers/responsive-order-rate-window";
import { readResponsiveBuildProvenance } from "../../scripts/responsive-build-provenance.mjs";

assertResponsiveQaTarget(process.env);

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

for (const printing of [false, true]) test(`RSP-Q01: one real order moves through customer, staff, KDS and desktop with printing=${printing}`, async ({ browser }, testInfo) => {
  test.setTimeout(660_000);
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
  let printerId = "", ruleId = "";
  const disabledPrinterIds: string[] = [];
  const observed: Array<{ step: string; status: string; at: string }> = [];
  const edgeSessionStatuses: number[] = [];
  const issuedSessionRequestIds: string[] = [];
  let rateLimitPreflight: { checkedAt: string; count: number; limit: number; expiresAt: string | null; waitedMs: number } | undefined;
  customer.page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/functions/v1/create-order-session"
      && response.request().method() === "POST") {
      edgeSessionStatuses.push(response.status());
      if (response.status() === 201) {
        const requestId = response.headers()["x-request-id"];
        if (requestId) issuedSessionRequestIds.push(requestId);
      }
    }
  });
  const observe = (step: string, status: string) => observed.push({ step, status, at: new Date().toISOString() });
  try {
    fixture = await createResponsiveOrderFixture(prisma);
    if (printing) {
      disabledPrinterIds.push(...(await prisma.printer.findMany({ where: { stallId: fixture.stallId, isEnabled: true }, select: { id: true } })).map((row) => row.id));
      await prisma.printer.updateMany({ where: { id: { in: disabledPrinterIds } }, data: { isEnabled: false } });
      printerId = (await prisma.printer.create({ data: { organizationId: fixture.organizationId, stallId: fixture.stallId, name: `A6 both modules ${fixture.runId}`, isEnabled: true, lastSeenAt: new Date() } })).id;
      ruleId = (await prisma.printRule.create({ data: { organizationId: fixture.organizationId, stallId: fixture.stallId, printerId, name: `A6 both modules ${fixture.runId}`, trigger: "ORDER_CONFIRMED", autoPrint: false } })).id;
      await prisma.stallOrderingSettings.update({ where: { stallId: fixture.stallId }, data: { printModuleEnabled: true } });
      // Synthetic hardware boundary only; real print commands and DB transitions below.
      await desktop.page.addInitScript(() => { window.print = () => { window.sessionStorage.setItem("a6-both-print", "called"); }; });
    }
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
    const sessionRequestId = issuedSessionRequestIds.at(-1);
    expect(sessionRequestId).toBeTruthy();
    rateLimitPreflight = await waitForOwnedOrderRateWindow(prisma, fixture.stallId, sessionRequestId!);
    console.info(JSON.stringify({ event: "responsive_order_rate_preflight", phase: "roundtrip", ...rateLimitPreflight }));
    await testInfo.attach("order-rate-window-preflight", {
      body: Buffer.from(JSON.stringify(rateLimitPreflight)), contentType: "application/json",
    });
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
    expect(await prisma.printJob.count({ where: { orderId } })).toBe(printing ? 1 : 0);
    if (printing) expect(await prisma.printJob.findFirstOrThrow({ where: { orderId }, select: { status: true, printerId: true } })).toEqual({ status: "PENDING", printerId });

    await login(kitchen.page, "kitchen@stallorder.test");
    await kitchen.page.goto(`/kitchen?stall=${fixture.stallSlug}`);
    await kitchen.page.getByRole("button", { name: new RegExp(`#${orderNo}\\b`) }).click();
    const kitchenOrder = kitchen.page.getByRole("article", { name: `#${orderNo}` });
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
    if (printing) {
      await desktop.page.goto(`/staff/${fixture.stallSlug}/print`);
      const printer = desktop.page.getByRole("article").filter({ hasText: `A6 both modules ${fixture.runId}`, has: desktop.page.getByRole("button", { name: "本機接手", exact: true }) });
      await printer.getByRole("button", { name: "本機接手", exact: true }).click();
      const feedback = desktop.page.getByRole("dialog", { name: "操作已完成", exact: true });
      await expect(feedback).toBeVisible();
      await feedback.getByRole("button", { name: "我知道了", exact: true }).click();
      const job = desktop.page.getByRole("article").filter({ hasText: orderNo });
      const claim = desktop.page.waitForResponse((response) => response.url().endsWith("/print-jobs") && response.request().postDataJSON()?.operation === "CLAIM");
      await job.getByRole("button", { name: "開始列印", exact: true }).click();
      expect((await claim).status()).toBe(200);
      await expect.poll(() => desktop.page.evaluate(() => sessionStorage.getItem("a6-both-print"))).toBe("called");
      const success = desktop.page.waitForResponse((response) => response.url().endsWith("/print-jobs") && response.request().postDataJSON()?.operation === "SUCCESS");
      await job.getByRole("button", { name: "成功", exact: true }).click();
      expect((await success).status()).toBe(200);
      expect((await prisma.printJob.findFirstOrThrow({ where: { orderId } })).status).toBe("SUCCEEDED");
      // With KDS enabled, printing cannot auto-complete payment or pickup.
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("READY");
    }
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
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    expect(await prisma.printJob.count({ where: { orderId } })).toBe(printing ? 1 : 0);
    const events = await prisma.orderEvent.findMany({
      where: { orderId }, orderBy: { createdAt: "asc" }, select: { eventType: true, createdAt: true },
    });
    const receipt = JSON.stringify({
        build,
        startedAt, finishedAt: new Date().toISOString(), runId: fixture.runId,
        edgeSessionStatuses, edgeOrderStatus: orderSubmissionStatus, rateLimitPreflight,
        orderId, orderNo, total: final.total, quantity: order.items[0].quantity,
        observed, events: events.map((event) => ({ type: event.eventType, at: event.createdAt.toISOString() })),
      }, null, 2);
    await writeFile(testInfo.outputPath("same-order-receipt.json"), `${receipt}\n`);
    await testInfo.attach("same-order-receipt", { contentType: "application/json", body: receipt });
  } finally {
    await Promise.allSettled([customer.context.close(), staff.context.close(), kitchen.context.close(), desktop.context.close()]);
    if (printing && fixture) {
      await prisma.stallOrderingSettings.update({ where: { stallId: fixture.stallId }, data: { printModuleEnabled: false } });
      if (ruleId) await prisma.printRule.delete({ where: { id: ruleId } });
      if (printerId) await prisma.printer.update({ where: { id: printerId }, data: { isEnabled: false } });
      await prisma.printer.updateMany({ where: { id: { in: disabledPrinterIds } }, data: { isEnabled: true } });
    }
    await prisma.$disconnect();
  }
});
