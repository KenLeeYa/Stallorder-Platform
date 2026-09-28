import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  continueQrCheckout,
  dismissStaffStartReminder,
  loginLocalTestAccount,
  qrProductSelectionControl,
} from "./local-navigation";

// Intentionally retained, dedicated lab data. No demo-store edits or GLOBAL overrides.
// The coordinator owns server startup and runtime execution; never start a server here.
function assertRelayLab() {
  const app = new URL(process.env.PLAYWRIGHT_APP_URL ?? "http://invalid");
  const db = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
  if (process.env.UI_UX_QA !== "true"
    || process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER !== "true"
    || app.origin !== "http://127.0.0.1:3023"
    || app.pathname !== "/" || app.search || app.hash
    || db.hostname !== "127.0.0.1" || db.port !== "55722" || db.pathname !== "/postgres"
    || !["postgres:", "postgresql:"].includes(db.protocol)) {
    throw new Error("QR_RELAY_REQUIRES_UI_UX_QA_3023_DB_55722_POSTGRES_AND_EXISTING_SERVER");
  }
  return app.origin;
}

const relayEnabled = process.env.UI_UX_QA === "true";
test.skip(!relayEnabled, "Dedicated retained 3023 relay lab only; separate CI cases cover public ordering.");
if (relayEnabled) assertRelayLab();
const prisma = new PrismaClient().$extends({
  query: { $allModels: { async $allOperations({ args, query }) {
    assertRelayLab();
    return query(args);
  } } },
});
const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
const organizationId = randomUUID();
const stallId = randomUUID();
const otherStallId = randomUUID();
const slug = `qa-relay-${suffix}`;
const otherSlug = `${slug}-other`;
const productName = "接力驗收餐";
const qrToken = `qa-relay-${randomUUID()}`;
const otherQrToken = `qa-relay-${randomUUID()}`;
let productId = "";
let cashPaymentOptionId = "";
let cashShiftId = "";
let orderId = "";
let orderNo = "";
let originalOrderPayload: (Record<string, unknown> & { items: Array<{ productId: string; quantity: number }> }) | null = null;
let originalTrackingToken = "";

test.use({
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
  // Raw browser artifacts contain QR/tracking/session credentials.
  trace: "off", video: "off", screenshot: "off",
});

function publicHeaders() {
  return {
    origin: assertRelayLab(),
    "x-stallorder-protocol-version": "1",
    "x-stallorder-operation-id": randomUUID(),
  };
}

async function staffHeaders(page: Page) {
  const origin = assertRelayLab();
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "stallorder_csrf");
  if (!csrf) throw new Error("QR_RELAY_CSRF_COOKIE_MISSING");
  return { origin, "x-csrf-token": csrf.value };
}

function waitForMutation(page: Page, path: string, method = "PATCH") {
  assertRelayLab();
  return page.waitForResponse((response) => new URL(response.url()).pathname === path
    && response.request().method() === method);
}

async function rolePage(browser: Browser, role: "staff" | "kitchen") {
  assertRelayLab();
  const context = await browser.newContext({
    baseURL: assertRelayLab(), locale: "zh-TW", timezoneId: "Asia/Taipei",
    serviceWorkers: "block", viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await loginLocalTestAccount(page, `${role}@stallorder.test`, "StallOrderDemo!2026");
    await page.goto(role === "staff" ? `/staff/${slug}` : `/kitchen?stall=${slug}`);
    if (role === "staff") await dismissStaffStartReminder(page);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function openCheckout(page: Page, quantity = 1) {
  assertRelayLab();
  const sessionResponse = waitForMutation(page, "/api/public/order-session", "POST");
  await page.goto(`/q/${qrToken}`);
  const issued = await sessionResponse;
  expect([200, 201]).toContain(issued.status());
  expect(issued.headers()["x-order-circuit"]).toBe("B");
  const session = await issued.json() as { orderSessionToken: string };
  expect(typeof session.orderSessionToken).toBe("string");
  const product = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName, exact: true }),
  });
  await qrProductSelectionControl(product, productName).click();
  for (let index = 1; index < quantity; index++) {
    await product.getByRole("button", { name: `增加 ${productName}`, exact: true }).filter({ visible: true }).click();
  }
  // This fixture has no modifiers: its quantity control adds directly to the cart.
  await page.getByTestId("qr-mobile-cart-summary").click();
  await page.getByTestId("qr-cart-panel").getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
  await continueQrCheckout(page);
  await page.getByLabel("訂單備註", { exact: true }).fill("本機 QR 接力驗收");
  const acknowledge = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
  if (await acknowledge.isVisible()) await acknowledge.check();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeEnabled({ timeout: 20_000 });
  return session;
}

async function submitCheckout(page: Page) {
  assertRelayLab();
  let pending = waitForMutation(page, "/api/public/orders", "POST");
  await page.getByRole("button", { name: "送出訂單", exact: true }).click();
  let response = await pending;
  if (response.status() === 422) {
    expect((await response.json()).code).toBe("WAIT_ACKNOWLEDGMENT_REQUIRED");
    await page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ }).check();
    pending = waitForMutation(page, "/api/public/orders", "POST");
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    response = await pending;
  }
  return response;
}

async function newPublicPayload(api: APIRequestContext) {
  const deviceId = randomUUID();
  const issued = await api.post("/api/public/order-session", {
    headers: publicHeaders(), data: { qrToken, deviceId, sessionRequestId: randomUUID(), orderingMode: "DEFAULT" },
  });
  expect(issued.status()).toBe(201);
  const session = await issued.json() as { orderSessionToken: string };
  return {
    qrToken, deviceId, orderSessionToken: session.orderSessionToken,
    orderingMode: "DEFAULT", clientOrderId: randomUUID(), idempotencyKey: randomUUID(),
    turnstileIdempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    customerName: "", customerPhone: "", customerNote: "本機拒絕邊界驗收",
    waitAcknowledged: true, items: [{ productId, quantity: 1 }],
  };
}

async function businessSnapshot() {
  // Audit/rate-limit logs may legitimately change on denied requests; business data may not.
  const [orders, payments, stock, tasks, shifts, movements] = await Promise.all([
    prisma.order.findMany({ where: { stallId }, orderBy: { id: "asc" }, select: {
      id: true, status: true, paymentStatus: true, total: true, completedAt: true,
      pickupVerifiedAt: true, updatedAt: true, items: { orderBy: { id: "asc" }, select: { id: true, quantity: true, status: true } },
    } }),
    prisma.payment.findMany({ where: { stallId }, orderBy: { id: "asc" } }),
    prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId } }, select: { stockRemaining: true } }),
    prisma.orderProductionTask.findMany({ where: { stallId }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
    prisma.cashShift.findMany({ where: { stallId }, orderBy: { id: "asc" } }),
    prisma.cashMovement.findMany({ where: { stallId }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ orders, payments, stock, tasks, shifts, movements });
}

test.describe("本機 QR 接力：顧客 → 店員 → 廚房 → 交付", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.beforeEach(({ page }, testInfo) => {
    assertRelayLab();
    // Persist only event metadata; request bodies, URLs and tokens stay private.
    mkdirSync(testInfo.outputDir, { recursive: true });
    const events: Array<Record<string, string | number>> = [];
    const record = (event: Record<string, string | number>) => {
      events.push({ at: new Date().toISOString(), ...event });
      writeFileSync(testInfo.outputPath("network-events.json"), JSON.stringify(events, null, 2));
    };
    const publicPath = (url: string) => {
      const path = new URL(url).pathname;
      return ["/api/public/orders", "/api/public/order-session"].includes(path) ? path : null;
    };
    page.on("request", (request) => {
      const path = publicPath(request.url());
      if (path) record({ event: "request", path, method: request.method() });
    });
    page.on("response", (response) => {
      const path = publicPath(response.url());
      if (path) record({ event: "response", path, status: response.status() });
    });
    page.on("requestfailed", (request) => {
      const path = publicPath(request.url());
      if (path) record({ event: "requestfailed", path, method: request.method() });
    });
    page.on("crash", () => record({ event: "page-crash" }));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        const path = new URL(frame.url()).pathname;
        record({ event: "navigate", path: path.startsWith("/order/") ? "/order/<redacted>" : path.startsWith("/q/") ? "/q/<redacted>" : "/other" });
      }
    });
  });

  test.beforeAll(async () => {
    assertRelayLab();
    const staff = await prisma.profile.findUniqueOrThrow({ where: { email: "staff@stallorder.test" } });
    const kitchen = await prisma.profile.findUniqueOrThrow({ where: { email: "kitchen@stallorder.test" } });
    const plan = await prisma.planVersion.findFirstOrThrow({ where: { plan: { code: "TRIAL" }, effectiveUntil: null } });
    const owner = await prisma.profile.create({ data: {
      email: `${slug}@stallorder.test`, displayName: "接力驗收店主", emailVerified: true, authMigrationRequired: false,
    } });
    await prisma.organization.create({ data: { id: organizationId, name: "本機 QR 接力驗收", slug, businessName: "本機驗收", status: "ACTIVE", email: `${slug}@stallorder.test`, phone: "0900000000" } });
    await prisma.subscription.create({ data: { organizationId, planId: plan.planId, planVersionId: plan.id, status: "ACTIVE", billingInterval: "MONTHLY", billingPeriodStart: new Date(), billingPeriodEnd: new Date(Date.now() + 30 * 86400_000) } });
    await prisma.organizationMembership.create({ data: { organizationId, profileId: owner.id, role: "ORGANIZATION_OWNER", allStalls: true, isPrimaryOwner: true } });
    for (const [id, stallSlug] of [[stallId, slug], [otherStallId, otherSlug]]) {
      await prisma.stall.create({ data: { id, organizationId, name: id === stallId ? "本機 QR 接力攤" : "本機跨攤權限對照", slug: stallSlug, code: stallSlug, address: "本機測試", location: "本機測試", isActive: true, businessStatus: "OPEN", orderingState: "OPEN", orderingEnabled: true } });
      await prisma.stallMembership.create({ data: { organizationId, stallId: id, profileId: staff.id, role: "STAFF" } });
    }
    await prisma.stallMembership.create({ data: { organizationId, stallId, profileId: kitchen.id, role: "KITCHEN" } });
    const category = await prisma.productCategory.create({ data: { organizationId, name: "接力驗收" } });
    const product = await prisma.product.create({ data: { organizationId, categoryId: category.id, name: productName, description: "本機接力驗收專用", defaultPrice: 50, stallProducts: { create: { organizationId, stallId, isEnabled: true, stockRemaining: 100 } } } });
    productId = product.id;
    const station = await prisma.kitchenStation.create({ data: { organizationId, stallId, code: "RELAY", name: "接力製餐區" } });
    await prisma.kitchenStationAssignment.create({ data: { organizationId, stallId, stationId: station.id, productId } });
    await prisma.stallBusinessHour.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId, stallId, dayOfWeek, opensAt: "00:00", closesAt: "00:00", isClosed: false })) });
    await prisma.stallOrderingSettings.create({ data: { organizationId, stallId, kdsModuleEnabled: true, paymentModuleEnabled: true, lotteryEnabled: false, enabledLocales: ["zh-TW"] } });
    await prisma.qrCode.createMany({ data: [qrToken, otherQrToken].map((token, index) => ({ organizationId, stallId, token, tokenVersion: index + 1, label: "本機 QR 接力", state: "ACTIVE" as const })) });
    cashPaymentOptionId = (await prisma.paymentOption.create({ data: { organizationId, stallId, code: "CASH", name: "現金", kind: "CASH" } })).id;
    cashShiftId = (await prisma.cashShift.create({ data: { organizationId, stallId, openingAmount: 0, openedById: staff.id, note: "本機 QR 接力保留資料" } })).id;
  });

  test.afterAll(async () => { await prisma.$disconnect(); });

  test("R1 真 QR 同單完成、重送去重、先收款與廚房製作交付", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await openCheckout(page, 2);
    const response = await submitCheckout(page);
    expect(response.status()).toBe(201);
    expect(response.headers()["x-order-circuit"]).toBe("B");
    const payload = response.request().postDataJSON();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].quantity).toBe(2);
    // Successful checkout navigates after the app parses its response. CDP may
    // discard that response body on navigation; validate the actual tracker URL.
    await expect.poll(() => /^\/order\/[^/]+$/.test(new URL(page.url()).pathname)).toBe(true);
    const created = { trackingToken: new URL(page.url()).pathname.slice("/order/".length) };
    originalOrderPayload = payload;
    originalTrackingToken = created.trackingToken;
    const row = await prisma.order.findUniqueOrThrow({ where: { trackingTokenHash: createHash("sha256").update(created.trackingToken).digest("hex") } });
    orderId = row.id;
    orderNo = row.orderNo;
    expect({ total: row.total, status: row.status, paymentStatus: row.paymentStatus, stallId: row.stallId }).toEqual({ total: 100, status: "WAITING_CONFIRMATION", paymentStatus: "UNPAID", stallId });
    const replay = await page.request.post("/api/public/orders", { headers: publicHeaders(), data: payload });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).trackingToken === created.trackingToken).toBe(true);
    expect(await prisma.order.count({ where: { stallId } })).toBe(1);
    expect((await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId } } })).stockRemaining).toBe(98);
    await expect.poll(() => new URL(page.url()).pathname === `/order/${created.trackingToken}`).toBe(true);
    await page.reload();
    await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);
    await page.goto(`/q/${qrToken}`);
    await expect.poll(() => new URL(page.url()).pathname === `/order/${created.trackingToken}`).toBe(true);
    await expect(page.getByText(`訂單 ${orderNo}`, { exact: true })).toBeVisible();

    const staff = await rolePage(browser, "staff");
    try {
      const queue = staff.page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: orderNo });
      await queue.click();
      const actions = staff.page.getByTestId("staff-order-actions-pane").filter({ visible: true });
      const patchPath = `/api/stalls/${slug}/orders/${orderId}`;
      await actions.getByRole("button", { name: "修改訂單內容", exact: true }).click();
      const editor = staff.page.getByRole("dialog").filter({ has: staff.page.locator("#order-edit-title") });
      await editor.getByRole("button", { name: `減少 ${productName} 數量`, exact: true }).click();
      await editor.getByRole("combobox", { name: "調整原因", exact: true }).selectOption("QUANTITY_ADJUSTMENT");
      const notice = "缺貨調整：接力驗收餐供應不足，原兩份改為一份，金額調整為 50 元。";
      await editor.getByRole("textbox", { name: "顧客會看到的通知", exact: true }).fill("");
      await expect(editor.getByRole("button", { name: "儲存並同步廚房", exact: true })).toBeDisabled();
      await editor.getByRole("textbox", { name: "顧客會看到的通知", exact: true }).fill(notice);
      const amendmentResponse = waitForMutation(staff.page, `${patchPath}/content`);
      await editor.getByRole("button", { name: "儲存並同步廚房", exact: true }).click();
      const savedAmendment = await amendmentResponse;
      expect(savedAmendment.status()).toBe(200);
      expect(savedAmendment.request().postDataJSON().publicAmendment).toEqual({ reason: "QUANTITY_ADJUSTMENT", customerMessage: notice });
      await expect(editor).not.toBeVisible();
      const amended = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      expect({ orderNo: amended.orderNo, total: amended.total, status: amended.status }).toEqual({ orderNo, total: 50, status: "WAITING_CONFIRMATION" });
      expect(amended.items.map((item) => ({ productId: item.productId, quantity: item.quantity }))).toEqual([{ productId, quantity: 1 }]);
      expect((await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId } } })).stockRemaining).toBe(99);
      const customerNotice = page.getByRole("dialog", { name: "訂單內容已由店家調整", exact: true });
      await expect(customerNotice.getByText(notice, { exact: true })).toBeVisible({ timeout: 30_000 });
      await customerNotice.getByRole("button", { name: "我知道了", exact: true }).last().click();
      await expect(page.getByText(`1 × ${productName}`, { exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname === `/order/${created.trackingToken}`).toBe(true);

      const beforeAmendedReplay = await businessSnapshot();
      const amendedReplay = await page.request.post("/api/public/orders", { headers: publicHeaders(), data: payload });
      expect(amendedReplay.status()).toBe(200);
      const amendedReplayBody = await amendedReplay.json() as { trackingToken: string; orderNo: string; totalAmount: number };
      expect(amendedReplayBody.trackingToken === created.trackingToken).toBe(true);
      expect({ orderNo: amendedReplayBody.orderNo, total: amendedReplayBody.totalAmount }).toEqual({ orderNo, total: 50 });
      const replayedOrder = await prisma.order.findUniqueOrThrow({ where: { trackingTokenHash: createHash("sha256").update(amendedReplayBody.trackingToken).digest("hex") }, include: { items: true } });
      expect(replayedOrder.id === orderId).toBe(true);
      expect(replayedOrder.total).toBe(50);
      expect(replayedOrder.items.map((item) => item.quantity)).toEqual([1]);
      // Even a payload matching the amended cart differs from the original intent.
      const amendedConflict = await page.request.post("/api/public/orders", {
        headers: publicHeaders(), data: { ...payload, items: [{ ...payload.items[0], quantity: 1 }] },
      });
      expect(amendedConflict.status()).toBe(409);
      expect((await amendedConflict.json()).code).toBe("IDEMPOTENCY_CONFLICT");
      expect(createHash("sha256").update(await businessSnapshot()).digest("hex")).toBe(createHash("sha256").update(beforeAmendedReplay).digest("hex"));
      expect(await prisma.order.count({ where: { stallId } })).toBe(1);
      expect((await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId } } })).stockRemaining).toBe(99);

      let pending = waitForMutation(staff.page, patchPath);
      await actions.getByRole("button", { name: "確認接單", exact: true }).click();
      expect((await pending).status()).toBe(200);
      await actions.getByRole("button", { name: "結帳收款", exact: true }).click();
      const paymentDialog = staff.page.getByRole("dialog", { name: "結帳收款", exact: true });
      await paymentDialog.getByRole("button", { name: "現金", exact: true }).click();
      await paymentDialog.getByLabel("客戶實收金額").fill("50");
      pending = waitForMutation(staff.page, patchPath);
      await paymentDialog.getByRole("button", { name: "確認收款", exact: true }).click();
      const paidResponse = await pending;
      expect(paidResponse.status()).toBe(200);
      const paymentPayload = paidResponse.request().postDataJSON();
      expect(paymentPayload).toMatchObject({ status: "COMPLETED", completionIntent: "COLLECT_PAYMENT", paymentOptionId: cashPaymentOptionId, cashReceived: 50 });
      const paid = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
      expect({ status: paid.status, paymentStatus: paid.paymentStatus, completedAt: paid.completedAt }).toEqual({ status: "CONFIRMED", paymentStatus: "PAID", completedAt: null });
      expect(paid.payment).toMatchObject({ amount: 50, cashShiftId, paymentOptionId: cashPaymentOptionId, cashReceived: 50, changeAmount: 0, method: "CASH" });
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      const repeatedPayment = await staff.page.request.patch(patchPath, { headers: await staffHeaders(staff.page), data: paymentPayload });
      expect(repeatedPayment.status()).toBe(409);
      expect((await repeatedPayment.json()).code).toBe("PAYMENT_ALREADY_RECORDED");

      const kitchen = await rolePage(browser, "kitchen");
      try {
        await kitchen.page.getByTestId("kitchen-order-queue-button").filter({ hasText: orderNo }).click();
        const items = kitchen.page.getByTestId("kitchen-order-items-pane");
        await expect(items).toContainText(productName);
        await expect(items.getByText(`${productName} × 1`, { exact: true })).toBeVisible();
        const board = await kitchen.page.request.get(`/api/stalls/${slug}/kitchen/board`);
        expect(board.status()).toBe(200);
        const safeBoard = JSON.stringify(await board.json());
        expect(safeBoard.includes(orderId)).toBe(true);
        expect(safeBoard.includes(productName)).toBe(true);
        for (const field of ["customerPhone", "deliveryAddress", "paymentStatus", "subtotal", "discountAmount", "total", "trackingToken", "deviceHash"]) {
          expect(safeBoard.includes(`"${field}"`), `Nonempty KDS excludes ${field}`).toBe(false);
        }
        for (const [button, status, queueCopy, customerCopy] of [
          ["開始製作", "PREPARING", "製作中", "製作中"],
          ["完成品項", "READY", "待取餐", "可取餐"],
        ] as const) {
          const taskResponse = waitForMutation(kitchen.page, `/api/stalls/${slug}/kitchen/tasks`);
          await items.getByRole("button", { name: button, exact: true }).click();
          expect((await taskResponse).status()).toBe(200);
          await expect.poll(async () => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(status);
          await expect(queue).toContainText(queueCopy, { timeout: 30_000 });
          await expect(page.getByText(`訂單 ${orderNo}`, { exact: true }).locator("..").getByText(customerCopy, { exact: true })).toBeVisible({ timeout: 30_000 });
          expect(new URL(page.url()).pathname === `/order/${created.trackingToken}`).toBe(true);
        }
      } finally { await kitchen.context.close(); }

      await actions.getByRole("button", { name: "完成訂單", exact: true }).click();
      const pickup = staff.page.getByRole("dialog", { name: "驗證取餐碼並完成訂單" });
      await pickup.getByRole("button", { name: "無法取得取餐碼", exact: true }).click();
      const manual = staff.page.getByRole("alertdialog", { name: "人工核對取餐" });
      await expect(manual).toContainText(orderNo);
      await manual.getByLabel("已向顧客核對稱呼與全部餐點內容").check();
      const verified = waitForMutation(staff.page, `${patchPath}/verify-pickup`, "POST");
      pending = waitForMutation(staff.page, patchPath);
      await manual.getByRole("button", { name: "確認人工取餐", exact: true }).click();
      expect((await verified).status()).toBe(200);
      const completed = await pending;
      expect(completed.status()).toBe(200);
      expect(completed.request().postDataJSON()).toEqual({ status: "COMPLETED", completionIntent: "FINALIZE" });
      await expect(queue).toHaveCount(0);
      await expect(page.getByText(`訂單 ${orderNo}`, { exact: true }).locator("..").getByText("已完成", { exact: true })).toBeVisible({ timeout: 30_000 });
      const final = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true, items: true } });
      expect(final.status).toBe("COMPLETED");
      expect(final.paymentStatus).toBe("PAID");
      expect(final.completedAt).not.toBeNull();
      expect(final.pickupVerifiedAt).not.toBeNull();
      expect(final.pickupVerificationMethod).toBe("MANUAL");
      expect(final.payment?.id === paid.payment?.id).toBe(true);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      expect(final.total).toBe(50);
      expect(final.items.map((item) => ({ quantity: item.quantity, status: item.status }))).toEqual([{ quantity: 1, status: "READY" }]);
      expect((await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId } } })).stockRemaining).toBe(99);
      await page.reload();
      await expect(page.getByText(`訂單 ${orderNo}`, { exact: true })).toBeVisible();
      await expect(page.getByText(`訂單 ${orderNo}`, { exact: true }).locator("..").getByText("已完成", { exact: true })).toBeVisible();
    } finally { await staff.context.close(); }
    await test.info().attach("R1-redacted-results", { contentType: "application/json", body: JSON.stringify({ case: "R1", circuit: "B", originalTotal: 100, originalQuantity: 2, total: 50, quantity: 1, staffAmendment: 200, originalReplayAfterAmendment: 200, changedPayloadAfterAmendment: 409, stockRemaining: 99, orderCount: 1, paymentCount: 1, state: "COMPLETED" }) });
  });

  test("R2 過期、商品售罄、人工暫停：server 拒絕與 UI 提示後恢復", async ({ page }) => {
    test.setTimeout(180_000);
    const beforeCount = await prisma.order.count({ where: { stallId } });
    const session = await openCheckout(page);
    const sessionWhere = { tokenHash: createHash("sha256").update(session.orderSessionToken).digest("hex") };
    const originalSession = await prisma.orderSession.findUniqueOrThrow({ where: sessionWhere });
    try {
      await prisma.orderSession.update({ where: sessionWhere, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const expired = await submitCheckout(page);
      expect(expired.status()).toBe(409);
      expect((await expired.json()).code).toBe("SESSION_EXPIRED");
      await expect(page.locator("main")).toContainText(/過期|逾時|已失效/);
      expect(await prisma.order.count({ where: { stallId } })).toBe(beforeCount);
    } finally {
      await prisma.orderSession.update({ where: sessionWhere, data: { expiresAt: originalSession.expiresAt, status: originalSession.status } });
    }

    const stockWhere = { stallId_productId: { stallId, productId } };
    const originalStock = await prisma.stallProduct.findUniqueOrThrow({ where: stockWhere });
    const stockPayload = await newPublicPayload(page.request);
    try {
      await prisma.stallProduct.update({ where: stockWhere, data: { stockRemaining: 0, isSoldOut: true } });
      const soldOut = await page.request.post("/api/public/orders", { headers: publicHeaders(), data: stockPayload });
      const soldOutCode = (await soldOut.json()).code;
      expect(soldOutCode).toMatch(/^(PRODUCT_STOCK_INSUFFICIENT|PRODUCT_UNAVAILABLE)$/);
      expect(soldOut.status()).toBe(soldOutCode === "PRODUCT_UNAVAILABLE" ? 400 : 409);
      await page.goto(`/q/${qrToken}`);
      const product = page.getByRole("article").filter({ has: page.getByRole("heading", { name: productName, exact: true }) });
      // Public menus filter sold-out products; no selectable card is rendered.
      await expect(product).toHaveCount(0);
      await expect(qrProductSelectionControl(product, productName)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "送出訂單", exact: true }).filter({ visible: true })).toHaveCount(0);
      expect(await prisma.order.count({ where: { stallId } })).toBe(beforeCount);
    } finally {
      await prisma.stallProduct.update({ where: stockWhere, data: { stockRemaining: originalStock.stockRemaining, isSoldOut: originalStock.isSoldOut } });
    }

    const pausedPayload = await newPublicPayload(page.request);
    const originalStall = await prisma.stall.findUniqueOrThrow({ where: { id: stallId } });
    try {
      await prisma.stall.update({ where: { id: stallId }, data: { orderingEnabled: false, businessStatus: "PAUSED", orderingState: "PAUSED" } });
      const paused = await page.request.post("/api/public/orders", { headers: publicHeaders(), data: pausedPayload });
      expect(paused.status()).toBe(409);
      expect((await paused.json()).code).toMatch(/ORDERING_PAUSED|STALL_CLOSED|CAPACITY_PAUSED/);
      await page.goto(`/q/${qrToken}`);
      await expect(page.locator("main")).toContainText(/暫停|關閉/);
      await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toHaveCount(0);
      expect(await prisma.order.count({ where: { stallId } })).toBe(beforeCount);
    } finally {
      await prisma.stall.update({ where: { id: stallId }, data: { orderingEnabled: originalStall.orderingEnabled, businessStatus: originalStall.businessStatus, orderingState: originalStall.orderingState } });
    }
    await page.goto(`/q/${qrToken}`);
    const restoredProduct = page.getByRole("article").filter({ has: page.getByRole("heading", { name: productName, exact: true }) });
    await expect(qrProductSelectionControl(restoredProduct, productName)).toBeEnabled();
    await newPublicPayload(page.request);
    expect(await prisma.order.count({ where: { stallId } })).toBe(beforeCount);
    await test.info().attach("R2-redacted-results", { contentType: "application/json", body: JSON.stringify({ case: "R2", rejected: ["expired", "sold-out", "paused"], newOrders: 0, restored: true }) });
  });

  test("R3 認證、Kitchen 權限、跨攤、CSRF、Origin 與 QR/session 隔離", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const staff = await rolePage(browser, "staff");
    try {
      const kitchen = await rolePage(browser, "kitchen");
      try {
        const before = await businessSnapshot();
        const path = `/api/stalls/${slug}/orders/${orderId}`;
        const mutation = { status: "CONFIRMED" };
        const anonymous = await page.request.patch(path, { headers: publicHeaders(), data: mutation });
        expect(anonymous.status()).toBe(401);
        const forbidden = await kitchen.page.request.patch(path, { headers: await staffHeaders(kitchen.page), data: mutation });
        expect(forbidden.status()).toBe(403);
        expect((await kitchen.page.request.get(`/api/stalls/${slug}/orders`)).status()).toBe(403);
        const board = await kitchen.page.request.get(`/api/stalls/${slug}/kitchen/board`);
        expect(board.status()).toBe(200);
        const serialized = JSON.stringify(await board.json());
        for (const field of ["customerPhone", "deliveryAddress", "paymentStatus", "subtotal", "discountAmount", "total", "trackingToken", "deviceHash"]) {
          expect(serialized.includes(`"${field}"`), `KDS excludes ${field}`).toBe(false);
        }
        await expect(kitchen.page.getByRole("button", { name: /結帳收款|確認收款/ })).toHaveCount(0);
        const headers = await staffHeaders(staff.page);
        assertRelayLab();
        const crossStall = await staff.page.request.patch(`/api/stalls/${otherSlug}/orders/${orderId}`, { headers, data: mutation });
        expect(crossStall.status()).toBe(404);
        const missingCsrf = await staff.page.request.patch(path, { headers: { origin: assertRelayLab() }, data: mutation });
        expect(missingCsrf.status()).toBe(403);
        assertRelayLab();
        const wrongOrigin = await staff.page.request.patch(path, { headers: { ...headers, origin: "https://invalid.example" }, data: mutation });
        expect(wrongOrigin.status()).toBe(403);
        const sessionsBefore = await prisma.orderSession.count({ where: { stallId } });
        const publicWrongOrigin = await page.request.post("/api/public/order-session", {
          headers: { ...publicHeaders(), origin: "https://invalid.example" },
          data: { qrToken, deviceId: randomUUID(), sessionRequestId: randomUUID(), orderingMode: "DEFAULT" },
        });
        expect(publicWrongOrigin.status()).toBe(403);
        expect((await publicWrongOrigin.json()).code).toBe("ORIGIN_NOT_ALLOWED");
        expect(await prisma.orderSession.count({ where: { stallId } })).toBe(sessionsBefore);
        const original = await newPublicPayload(page.request);
        const mismatched = await page.request.post("/api/public/orders", { headers: publicHeaders(), data: { ...original, qrToken: otherQrToken } });
        // Canonical preflight hides a QR/session binding mismatch, even in one stall.
        expect(mismatched.status()).toBe(404);
        expect((await mismatched.json()).code).toBe("SESSION_NOT_FOUND");
        // Compare a digest so an assertion failure cannot print business records.
        expect(createHash("sha256").update(await businessSnapshot()).digest("hex")).toBe(createHash("sha256").update(before).digest("hex"));
      } finally { await kitchen.context.close(); }
    } finally { await staff.context.close(); }
    await test.info().attach("R3-redacted-results", { contentType: "application/json", body: JSON.stringify({ case: "R3", unauthorized: 401, kitchen: 403, crossStall: 404, csrf: 403, staffOrigin: 403, circuitBOrigin: 403, qrSession: 404, qrSessionCode: "SESSION_NOT_FOUND", businessDataUnchanged: true }) });
  });

  test("R4 已知失敗契約：同 key 不同數量必須回 409 且不改業務資料", async ({ page }) => {
    const payload = originalOrderPayload;
    if (!payload || !originalTrackingToken) throw new Error("QR_RELAY_R4_REQUIRES_R1_ORDER");
    const before = await businessSnapshot();
    const conflict = await page.request.post("/api/public/orders", {
      headers: publicHeaders(), data: { ...payload, items: [{ ...payload.items[0], quantity: 3 }] },
    });
    const body = await conflict.json() as { code?: string; trackingToken?: string };
    const unchanged = createHash("sha256").update(await businessSnapshot()).digest("hex")
      === createHash("sha256").update(before).digest("hex");
    await test.info().attach("R4-redacted-results", { contentType: "application/json", body: JSON.stringify({
      case: "R4", expectedStatus: 409, actualStatus: conflict.status(),
      expectedCode: "IDEMPOTENCY_CONFLICT", actualCode: body.code ?? null,
      replayedOriginalOrder: body.trackingToken === originalTrackingToken, businessDataUnchanged: unchanged,
    }) });
    // Keep this red visible; never mark it expected-to-fail or skip the contract.
    expect.soft(conflict.status()).toBe(409);
    expect.soft(body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(unchanged).toBe(true);
    expect(await prisma.order.count({ where: { stallId } })).toBe(1);
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
  });
});
