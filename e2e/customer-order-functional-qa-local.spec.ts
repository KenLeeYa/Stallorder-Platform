import { randomInt, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { dismissStaffStartReminder, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const qrToken = "functional-qa-" + randomUUID();
const orderIds: string[] = [];
let qrId = "", productId = "";
let originalHours: Awaited<ReturnType<typeof prisma.stallBusinessHour.findMany>>;
let staff: APIRequestContext;
let staffHeaders: Record<string, string>;

test.use({ serviceWorkers: "block", actionTimeout: 10_000 });

function publicHeaders(ip = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`) {
  return { origin: process.env.PLAYWRIGHT_APP_URL!, "x-stallorder-protocol-version": "1",
    "x-stallorder-operation-id": randomUUID(), "cf-connecting-ip": ip, "x-vercel-forwarded-for": ip };
}

test.beforeAll(async ({ playwright }) => {
  for (const [value, port] of [[process.env.DATABASE_URL, "55722"], [process.env.NEXT_PUBLIC_SUPABASE_URL, "55721"]]) {
    const url = new URL(value ?? "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== port) throw new Error("DEDICATED_FUNCTIONAL_QA_LAB_REQUIRED");
  }
  originalHours = await prisma.stallBusinessHour.findMany({ where: { stallId } });
  await prisma.stallBusinessHour.updateMany({ where: { stallId }, data: { opensAt: "00:00", closesAt: "23:59", lastOrderAt: null, isClosed: false } });
  const category = await prisma.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true } });
  productId = (await prisma.product.create({ data: { organizationId, categoryId: category.id,
    name: "訂單往返 QA 餐", description: "Dedicated local functional fixture", defaultPrice: 50,
    stallProducts: { create: { organizationId, stallId, isEnabled: true, stockRemaining: 100 } },
  } })).id;
  const version = await prisma.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } });
  qrId = (await prisma.qrCode.create({ data: { organizationId, stallId, token: qrToken, label: "Functional QA", state: "ACTIVE",
    tokenVersion: (version._max.tokenVersion ?? 0) + 1 } })).id;
  staff = await playwright.request.newContext({ baseURL: process.env.PLAYWRIGHT_APP_URL });
  const login = await staff.post("/api/auth/login", { headers: publicHeaders(), data: {
    email: "staff@stallorder.test", password: "StallOrderDemo!2026",
  } });
  expect(login.status()).toBe(200);
  const cookies = (await staff.storageState()).cookies;
  staffHeaders = { ...publicHeaders(), "x-csrf-token": cookies.find(cookie => cookie.name === "stallorder_csrf")!.value,
    cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") };
});

test.afterAll(async () => {
  try {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (qrId) {
      await prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId: qrId } });
      await prisma.orderSession.deleteMany({ where: { qrCodeId: qrId } });
      await prisma.qrCode.delete({ where: { id: qrId } });
    }
    if (productId) {
      await prisma.stallProduct.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    for (const row of originalHours ?? []) await prisma.stallBusinessHour.update({ where: { id: row.id }, data: {
      opensAt: row.opensAt, closesAt: row.closesAt, lastOrderAt: row.lastOrderAt, isClosed: row.isClosed,
    } });
  } finally { await staff?.dispose(); await prisma.$disconnect(); }
});

async function createOrder(request: APIRequestContext) {
  const headers = publicHeaders(), deviceId = randomUUID(), id = randomUUID();
  orderIds.push(id);
  const issued = await request.post("/api/public/order-session", { headers, data: {
    qrToken, deviceId, orderingMode: "PREORDER", sessionRequestId: randomUUID(),
  } });
  expect(issued.status(), (await issued.json()).code).toBe(201);
  const session = await issued.json();
  const slots = session.preorderSlots as string[];
  expect(slots.length).toBeGreaterThan(9);
  const created = await request.post("/api/public/orders", { headers, data: {
    qrToken, deviceId, orderingMode: "PREORDER", orderSessionToken: session.orderSessionToken,
    clientOrderId: id, idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(),
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", customerName: "往返流程 QA", customerPhone: "0912345678",
    scheduledPickupAt: slots[4], waitAcknowledged: true, items: [{ productId, quantity: 1 }],
  } });
  expect(created.status(), (await created.json()).code).toBe(201);
  const trackingToken = (await created.json()).trackingToken as string;
  return { id, deviceId, slots, trackingToken, headers, path: "/api/public/orders/" + trackingToken };
}
type OrderFixture = Awaited<ReturnType<typeof createOrder>>;

async function propose(order: OrderFixture, version: number, slot = 5) {
  const response = await staff.patch(`/api/stalls/aming-chicken/orders/${order.id}/fulfillment-time`, {
    headers: staffHeaders, data: { operation: "PROPOSE", version, proposedFulfillmentAt: order.slots[slot], reason: "QA 取餐時間協調" },
  });
  expect(response.status(), (await response.json()).code).toBe(200);
}

async function openTracker(page: Page, order: OrderFixture) {
  await page.setExtraHTTPHeaders(order.headers);
  await page.context().addCookies([{ name: "stallorder_device", value: order.deviceId, url: process.env.PLAYWRIGHT_APP_URL! }]);
  await page.goto("/order/" + order.trackingToken);
  await expect(page.getByRole("button", { name: "接受新取餐時間", exact: true })).toBeVisible();
}

const acceptButton = (page: Page) => page.getByRole("button", { name: "接受新取餐時間", exact: true });
const responseToTime = (page: Page) => page.waitForResponse(response => response.url().endsWith("/fulfillment-time") && response.request().method() === "POST");

test("staff tablet time dialog and customer phone complete three rounds without stale success messages", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const order = await createOrder(page.request);
  const orderNo = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).orderNo;
  const staffContext = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_APP_URL,
    storageState: await staff.storageState(), viewport: { width: 1024, height: 768 }, locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const staffPage = await staffContext.newPage();
  try {
    await gotoLocalPath(staffPage, "/staff/aming-chicken");
    await dismissStaffStartReminder(staffPage);
    for (let round = 0; round < 3; round++) {
      await staffPage.getByRole("button", { name: "重新整理", exact: true }).click();
      await staffPage.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: orderNo }).click();
      const action = staffPage.getByTestId("staff-order-actions-pane").getByRole("button", { name: "提出新時間", exact: true });
      await expect(action).toBeEnabled();
      await action.click();
      const dialog = staffPage.getByRole("dialog", { name: "提出新的取餐時間", exact: true });
      await expect(dialog).toBeVisible();
      const at = new Date(order.slots[5 + round]);
      const date = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
      const time = at.toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour12: false });
      await dialog.getByLabel("取餐日期", { exact: true }).fill(date);
      await dialog.locator("select").nth(0).selectOption(time.slice(0, 2));
      await dialog.locator("select").nth(1).selectOption(time.slice(3, 5));
      await dialog.getByRole("textbox", { name: "調整原因", exact: true }).fill(`第 ${round + 1} 次協調`);
      const sent = staffPage.waitForResponse(response => response.url().endsWith(`/orders/${order.id}/fulfillment-time`) && response.request().method() === "PATCH");
      await dialog.getByRole("button", { name: "通知顧客確認", exact: true }).click();
      expect((await sent).status()).toBe(200);
      await expect(dialog).not.toBeVisible();
      if (round === 0) await openTracker(page, order);
      await expect(acceptButton(page)).toBeVisible();
      await expect(page.getByText("已接受店家提議的新時間。", { exact: true })).not.toBeVisible();
      const received = responseToTime(page);
      await (round === 0 ? page.getByRole("button", { name: /無法接受/ }) : acceptButton(page)).click();
      expect((await received).status()).toBe(200);
      await expect(acceptButton(page)).not.toBeVisible();
    }
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.fulfillmentTimeVersion).toBe(4);
    expect(stored.committedFulfillmentAt?.getTime()).toBe(new Date(order.slots[7]).getTime());
    expect(stored.requestedFulfillmentAt?.getTime()).toBe(new Date(order.slots[4]).getTime());
    await staffPage.screenshot({ path: test.info().outputPath("staff-three-time-rounds.png") });
    await page.screenshot({ path: test.info().outputPath("customer-three-time-rounds.png") });
  } finally { await staffContext.close(); }
});

test("two tabs cannot overwrite an answered proposal and reconnect receives a newer proposal", async ({ page }) => {
  test.setTimeout(90_000);
  const order = await createOrder(page.request);
  await propose(order, 1);
  await openTracker(page, order);
  const second = await page.context().newPage();
  const trackingUrl = (url: URL) => url.pathname === order.path || url.pathname.endsWith("/get-public-order");
  try {
    await openTracker(second, order);
    const snapshot = await (await page.request.get(order.path, { headers: { ...order.headers, "x-stallorder-device-id": order.deviceId } })).json();
    await second.route(trackingUrl, route => route.request().method() === "OPTIONS" ? route.continue()
      : route.fulfill({ json: snapshot, headers: { "access-control-allow-origin": process.env.PLAYWRIGHT_APP_URL! } }));
    const accepted = responseToTime(page);
    await acceptButton(page).click();
    expect((await accepted).status()).toBe(200);
    const stale = responseToTime(second);
    await second.getByRole("button", { name: /無法接受/ }).click();
    expect((await stale).status()).toBe(409);
    await expect(second.locator('section[aria-labelledby="fulfillment-time-heading"]').getByRole("alert")).toContainText(/更新|失效|回覆/);
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, eventType: "FULFILLMENT_TIME_ACCEPTED" } })).toBe(1);
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, eventType: "FULFILLMENT_TIME_DECLINED" } })).toBe(0);
    await second.unroute(trackingUrl);
    await expect(acceptButton(second)).not.toBeVisible();
    await second.close();

    await page.context().setOffline(true);
    await expect(page.getByTestId("public-order-sync-status")).toContainText(/離線|連線/);
    await propose(order, 2, 6);
    await page.waitForTimeout(3_500);
    await expect(page.getByRole("alertdialog", { name: "即時訂單狀態" })).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(acceptButton(page)).toBeVisible();
    await expect(page.getByTestId("public-order-sync-status")).not.toBeVisible();
    await expect(page.getByText("已接受店家提議的新時間。", { exact: true })).not.toBeVisible();
    const acceptedNew = responseToTime(page);
    await acceptButton(page).click();
    expect((await acceptedNew).status()).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).committedFulfillmentAt?.getTime()).toBe(new Date(order.slots[6]).getTime());
  } finally { await page.context().setOffline(false); if (!second.isClosed()) await second.close(); }
});

test("a delayed old tracking response cannot revive an accepted proposal", async ({ page }) => {
  test.setTimeout(60_000);
  const order = await createOrder(page.request);
  await propose(order, 1);
  await openTracker(page, order);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let intercepted = false;
  await page.route(url => url.pathname === order.path || url.pathname.endsWith("/get-public-order"), async route => {
    if (intercepted || route.request().method() === "OPTIONS") return route.continue();
    const old = await route.fetch();
    expect(old.status()).toBe(200);
    intercepted = true;
    await barrier;
    await route.fulfill({ response: old });
  });
  try {
    await expect.poll(() => intercepted).toBe(true);
    const accepted = responseToTime(page);
    await acceptButton(page).click();
    expect((await accepted).status()).toBe(200);
    await expect(acceptButton(page)).not.toBeVisible();
    release();
    await page.waitForTimeout(3_500);
    await expect(acceptButton(page)).not.toBeVisible();
    await expect(page.getByRole("alertdialog", { name: "即時訂單狀態" })).toHaveCount(0);
  } finally { release(); }
});

test("expiry, response loss, duplicate commands and a cancelled order keep authoritative state", async ({ page }) => {
  test.setTimeout(90_000);
  const order = await createOrder(page.request);
  await propose(order, 1);
  await openTracker(page, order);
  const stock = (await prisma.stallProduct.findFirstOrThrow({ where: { stallId, productId } })).stockRemaining;
  await prisma.order.update({ where: { id: order.id }, data: { fulfillmentTimeResponseExpiresAt: new Date(Date.now() - 1_000) } });
  const expired = responseToTime(page);
  await acceptButton(page).click();
  expect((await expired).status()).toBe(409);
  await expect(page.locator('section[aria-labelledby="fulfillment-time-heading"]').getByRole("alert")).toContainText(/逾期|逾時|失效/);
  await expect(acceptButton(page)).not.toBeVisible();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).fulfillmentTimeState).toBe("EXPIRED");
  expect((await prisma.stallProduct.findFirstOrThrow({ where: { stallId, productId } })).stockRemaining).toBe(stock);
  await propose(order, 2, 6);
  await expect(acceptButton(page)).toBeVisible();
  let committed = false;
  await page.route("**" + order.path + "/fulfillment-time", async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed = true;
    await route.abort("failed");
  });
  await acceptButton(page).click();
  await expect.poll(() => committed).toBe(true);
  await page.unroute("**" + order.path + "/fulfillment-time");
  await expect(acceptButton(page)).not.toBeVisible();
  await expect(page.locator('section[aria-labelledby="fulfillment-time-heading"]').getByRole("alert")).toHaveCount(0);
  const duplicate = await page.request.post(order.path + "/fulfillment-time", { headers: order.headers, data: { deviceId: order.deviceId, version: 3, response: "ACCEPT" } });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).code).toBe("FULFILLMENT_TIME_PROPOSAL_STALE");
  expect(await prisma.orderEvent.count({ where: { orderId: order.id, eventType: "FULFILLMENT_TIME_ACCEPTED" } })).toBe(1);
  await propose(order, 3, 7);
  const cancelled = await page.request.delete(order.path, { headers: order.headers, data: { deviceId: order.deviceId } });
  expect(cancelled.status()).toBe(200);
  const afterCancel = await page.request.post(order.path + "/fulfillment-time", { headers: order.headers, data: { deviceId: order.deviceId, version: 4, response: "ACCEPT" } });
  expect(afterCancel.status()).toBe(409);
  expect((await afterCancel.json()).code).toBe("FULFILLMENT_TIME_UNAVAILABLE");
  expect((await prisma.stallProduct.findFirstOrThrow({ where: { stallId, productId } })).stockRemaining).toBe(stock! + 1);
  await page.reload();
  await expect(acceptButton(page)).not.toBeVisible();
});

test("Node and Edge share one tracking budget without starving other orders or mutations on shared Wi-Fi", async ({ request }) => {
  test.setTimeout(120_000);
  const first = await createOrder(request), second = await createOrder(request), third = await createOrder(request);
  await propose(first, 1);
  const headers = publicHeaders();
  const edge = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/get-public-order";
  const read = (order: OrderFixture, useEdge: boolean) => useEdge
    ? request.post(edge, { headers, data: { trackingToken: order.trackingToken, deviceId: order.deviceId } })
    : request.get(order.path, { headers: { ...headers, "x-stallorder-device-id": order.deviceId } });
  const start = Date.now();
  for (let index = 0; index < 60; index++) expect((await read(first, index % 2 === 0)).status()).toBe(200);
  expect(Date.now() - start).toBeLessThan(55_000);
  for (const useEdge of [false, true]) {
    const limited = await read(first, useEdge);
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await limited.json()).retryAfterSeconds).toBeGreaterThan(0);
  }
  for (let index = 0; index < 50; index++) {
    expect((await read(second, index % 2 === 0)).status()).toBe(200);
    expect((await read(third, index % 2 !== 0)).status()).toBe(200);
  }
  const reply = await request.post(first.path + "/fulfillment-time", { headers, data: { deviceId: first.deviceId, version: 2, response: "DECLINE" } });
  expect(reply.status()).toBe(200);
  const cancelled = await request.delete(first.path, { headers, data: { deviceId: first.deviceId } });
  expect(cancelled.status()).toBe(200);
  for (const useEdge of [false, true]) {
    const wrong = await read({ ...second, deviceId: randomUUID() }, useEdge);
    expect(wrong.status()).toBe(404);
    const body = await wrong.json();
    expect(body.order).toBeUndefined();
    expect(body.code).toBe("ORDER_NOT_FOUND");
  }
});

for (const operation of ["PROPOSE", "CONFIRM_REQUESTED"] as const) {
  test(operation + " cannot change an order cancelled while the staff request waits for the row lock", async ({ request }) => {
    test.setTimeout(60_000);
    const order = await createOrder(request);
    let release!: () => void, locked!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const hasLock = new Promise<void>(resolve => { locked = resolve; });
    const cancellation = prisma.$transaction(async tx => {
      await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      locked();
      await barrier;
    }, { timeout: 20_000 });
    await hasLock;
    const pending = staff.patch(`/api/stalls/aming-chicken/orders/${order.id}/fulfillment-time`, {
      headers: staffHeaders, data: operation === "PROPOSE"
        ? { operation, version: 1, proposedFulfillmentAt: order.slots[6], reason: "併發取消驗收" }
        : { operation, version: 1 },
    });
    try {
      await expect.poll(async () => {
        const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          select exists(select 1 from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and query ilike '%UPDATE%orders%' and query ilike '%fulfillment_time%') as waiting
        `;
        return row.waiting;
      }).toBe(true);
    } finally { release(); await cancellation; }
    const response = await pending;
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("CONFLICT");
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("CANCELLED");
    expect(stored.fulfillmentTimeVersion).toBe(1);
    expect(stored.fulfillmentTimeState).toBe("REQUESTED");
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, eventType: { startsWith: "FULFILLMENT_TIME_" } } })).toBe(0);
  });
}
