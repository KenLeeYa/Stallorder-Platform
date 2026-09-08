import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = randomUUID();
const qrToken = "tracking-idle-" + randomUUID();
let qrId = "";
let productId = "";
let circuitFlagOverrideId = "";
let originalHours: Awaited<ReturnType<typeof prisma.stallBusinessHour.findMany>>;

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== (process.env.CI ? "54322" : "55722")) {
    throw new Error("DEDICATED_TRACKING_LOCAL_LAB_REQUIRED");
  }
  originalHours = await prisma.stallBusinessHour.findMany({ where: { stallId } });
  const flag = await prisma.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "DUAL_ORDER_INTAKE_ENABLED" }, select: { id: true } });
  circuitFlagOverrideId = (await prisma.resilienceFeatureFlagOverride.create({ data: {
    flagId: flag.id, scopeType: "GLOBAL", enabled: true,
    reason: "Isolated idle tracking Circuit B regression",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  } })).id;
  await prisma.stallBusinessHour.updateMany({ where: { stallId }, data: { opensAt: "00:00", closesAt: "23:59", isClosed: false, lastOrderAt: null } });
  const category = await prisma.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true } });
  productId = (await prisma.product.create({ data: {
    organizationId, categoryId: category.id, name: "閒置追蹤驗收餐", description: "local tracking fixture", defaultPrice: 50,
    stallProducts: { create: { organizationId, stallId, isEnabled: true, stockRemaining: 5 } },
  } })).id;
  const version = await prisma.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } });
  qrId = (await prisma.qrCode.create({ data: {
    organizationId, stallId, token: qrToken, label: "Tracking idle QA", state: "ACTIVE",
    tokenVersion: (version._max.tokenVersion ?? 0) + 1,
  } })).id;
});

test.afterAll(async () => {
  try {
    if (circuitFlagOverrideId) await prisma.resilienceFeatureFlagOverride.deleteMany({ where: { id: circuitFlagOverrideId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    if (qrId) {
      await prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId: qrId } });
      await prisma.orderSession.deleteMany({ where: { qrCodeId: qrId } });
      await prisma.qrCode.delete({ where: { id: qrId } });
    }
    if (productId) {
      await prisma.stallProduct.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    for (const row of originalHours ?? []) {
      await prisma.stallBusinessHour.update({ where: { id: row.id }, data: {
        opensAt: row.opensAt, closesAt: row.closesAt, isClosed: row.isClosed, lastOrderAt: row.lastOrderAt,
      } });
    }
  } finally { await prisma.$disconnect(); }
});

test("decline then re-propose survives six real idle minutes and a temporary tracking cooldown", async ({ page, playwright }) => {
  test.setTimeout(480_000);
  const origin = process.env.PLAYWRIGHT_APP_URL!;
  const clientIp = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
  const headers = {
    origin, "x-stallorder-protocol-version": "1", "x-stallorder-operation-id": randomUUID(),
    "cf-connecting-ip": clientIp, "x-vercel-forwarded-for": clientIp,
  };
  await page.setExtraHTTPHeaders(headers);
  const deviceId = randomUUID();
  const sessionResponse = await page.request.post("/api/public/order-session", { headers, data: {
    qrToken, deviceId, orderingMode: "PREORDER", sessionRequestId: randomUUID(),
  } });
  expect(sessionResponse.status()).toBe(201);
  const session = await sessionResponse.json();
  const slots = session.preorderSlots as string[];
  expect(slots.length).toBeGreaterThan(7);
  const create = await page.request.post("/api/public/orders", { headers, data: {
    qrToken, deviceId, orderingMode: "PREORDER", orderSessionToken: session.orderSessionToken,
    clientOrderId: orderId, idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(),
    customerName: "閒置流程測試", customerPhone: "0912345678", waitAcknowledged: true,
    scheduledPickupAt: slots[4], items: [{ productId, quantity: 1 }], turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
  } });
  expect(create.status()).toBe(201);
  const trackingToken = (await create.json()).trackingToken as string;
  const publicPath = "/api/public/orders/" + trackingToken;
  const staff = await playwright.request.newContext({ baseURL: origin });
  try {
    const login = await staff.post("/api/auth/login", { headers, data: {
      email: "staff@stallorder.test", password: "StallOrderDemo!2026",
    } });
    expect(login.status()).toBe(200);
    const cookies = (await staff.storageState()).cookies;
    const staffHeaders = { ...headers, "x-csrf-token": cookies.find(cookie => cookie.name === "stallorder_csrf")!.value,
      cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") };
    const propose = async (version: number, at: string) => {
      const response = await staff.patch(`/api/stalls/aming-chicken/orders/${orderId}/fulfillment-time`, {
        headers: staffHeaders, data: { operation: "PROPOSE", version, proposedFulfillmentAt: at, reason: "閒置追蹤驗收" },
      });
      expect(response.status()).toBe(200);
    };
    await page.context().addCookies([{ name: "stallorder_device", value: deviceId, url: origin }]);
    await propose(1, slots[5]);
    const readStatuses: number[] = [];
    const trackingUrl = (url: URL) => url.pathname === publicPath || url.pathname.endsWith("/get-public-order");
    page.on("response", response => {
      if (trackingUrl(new URL(response.url())) && response.request().method() !== "OPTIONS") {
        readStatuses.push(response.status());
      }
    });
    await page.goto("/order/" + trackingToken);
    const declined = page.waitForResponse(response => response.url().endsWith("/fulfillment-time") && response.request().method() === "POST");
    await page.getByRole("button", { name: /無法接受/ }).click();
    expect((await declined).status()).toBe(200);
    await expect(page.getByText(/已通知店家此時間無法配合/)).toBeVisible();
    await propose(2, slots[6]);
    const accept = page.getByRole("button", { name: "接受新取餐時間", exact: true });
    await expect(accept).toBeVisible();
    const started = Date.now();
    for (let second = 0; second < 360; second++) {
      await page.waitForTimeout(1_000);
      expect(readStatuses.filter(status => status !== 200), "idle tracking must not exhaust its own quota").toEqual([]);
      await expect(page.getByRole("alertdialog", { name: "即時訂單狀態" })).toHaveCount(0);
      if ((second + 1) % 60 === 0) console.log(JSON.stringify({ idleSeconds: Math.floor((Date.now() - started) / 1_000), trackingReads: readStatuses.length }));
    }
    expect(readStatuses.length).toBeGreaterThanOrEqual(100);
    const pending = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(pending.fulfillmentTimeState).toBe("CUSTOMER_ACTION_REQUIRED");
    expect(pending.fulfillmentTimeVersion).toBe(3);
    expect(pending.pendingFulfillmentAt?.getTime()).toBe(new Date(slots[6]).getTime());
    expect(pending.requestedFulfillmentAt?.getTime()).toBe(new Date(slots[4]).getTime());
    expect((await prisma.stallProduct.findFirstOrThrow({ where: { stallId, productId } })).stockRemaining).toBe(4);

    let interceptedReads = 0;
    await page.route(trackingUrl, async route => {
      if (route.request().method() === "OPTIONS") return route.continue();
      interceptedReads += 1;
      if (interceptedReads === 1) return route.fulfill({ status: 429, contentType: "application/json",
        headers: { "retry-after": "5", "access-control-allow-origin": origin }, body: JSON.stringify({ code: "RATE_LIMITED", retryAfterSeconds: 5 }) });
      await route.continue();
    });
    await expect(page.getByTestId("public-order-sync-status")).toBeVisible();
    await expect(page.getByRole("alertdialog", { name: "即時訂單狀態" })).toHaveCount(0);
    await page.getByRole("button", { name: "重新整理訂單", exact: true }).click();
    await page.waitForTimeout(1_000);
    expect(interceptedReads).toBe(1);
    const accepted = page.waitForResponse(response => response.url().endsWith("/fulfillment-time") && response.request().method() === "POST");
    await accept.click();
    expect((await accepted).status()).toBe(200);
    await expect(accept).not.toBeVisible();
    await expect(page.getByTestId("public-order-sync-status")).not.toBeVisible();
    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(finalOrder.committedFulfillmentAt?.getTime()).toBe(new Date(slots[6]).getTime());
    expect(await prisma.orderEvent.count({ where: { orderId, eventType: "FULFILLMENT_TIME_DECLINED" } })).toBe(1);
    expect(await prisma.orderEvent.count({ where: { orderId, eventType: "FULFILLMENT_TIME_ACCEPTED" } })).toBe(1);
    await page.screenshot({ path: test.info().outputPath("idle-proposal-recovered.png") });
  } finally { await staff.dispose(); }
});
