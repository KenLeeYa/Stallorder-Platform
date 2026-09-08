import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath, dismissStaffStartReminder } from "./local-navigation";

const prisma = new PrismaClient();
let circuitOverrideId = "";
test.use({ serviceWorkers: "block" });
test.afterAll(async () => {
  try { if (circuitOverrideId) await prisma.resilienceFeatureFlagOverride.deleteMany({ where: { id: circuitOverrideId } }); }
  finally { await prisma.$disconnect(); }
});

test("retained peak-hour orders raise quotes, pause safely, recover automatically and respect manual closure", async ({ page }) => {
  test.setTimeout(240_000);
  const db = new URL(process.env.DATABASE_URL ?? "");
  const app = process.env.PLAYWRIGHT_APP_URL!;
  if (!["localhost", "127.0.0.1"].includes(db.hostname) || db.port !== (process.env.CI ? "54322" : "55722") || !["localhost", "127.0.0.1"].includes(new URL(app).hostname)) throw new Error("DEDICATED_SURGE_LAB_REQUIRED");
  const suffix = Date.now().toString();
  const organizationId = randomUUID(), stallId = randomUUID(), slug = "qa-surge-" + suffix;
  const owner = await prisma.profile.create({ data: {
    email: slug + "@stallorder.test", displayName: "QA 尖峰店主",
    emailVerified: true, authMigrationRequired: false,
  } });
  const plan = await prisma.planVersion.findFirstOrThrow({ where: { plan: { code: "TRIAL" }, effectiveUntil: null } });
  await prisma.organization.create({ data: { id: organizationId, name: "QA 尖峰與關店 " + suffix.slice(-4), slug, businessName: "本機流程範例", status: "ACTIVE", email: slug + "@stallorder.test", phone: "0900000000" } });
  await prisma.subscription.create({ data: { organizationId, planId: plan.planId, planVersionId: plan.id, status: "ACTIVE", billingInterval: "MONTHLY", billingPeriodStart: new Date(), billingPeriodEnd: new Date(Date.now() + 30 * 86400_000) } });
  await prisma.stall.create({ data: { id: stallId, organizationId, name: "尖峰流程範例攤位", slug, code: "qa-surge-" + suffix.slice(-7), address: "本機測試", location: "本機測試", isActive: true, businessStatus: "OPEN", orderingState: "OPEN", orderingEnabled: true } });
  await prisma.organizationMembership.create({ data: { organizationId, profileId: owner.id, role: "ORGANIZATION_OWNER", allStalls: true, isPrimaryOwner: true } });
  // Retain local examples for the demo accounts without changing the shared CI
  // accounts' organization/stall navigation for unrelated tests in later shards.
  if (!process.env.CI) for (const [email, role] of [["owner@stallorder.test", "ORGANIZATION_OWNER"], ["staff@stallorder.test", "STAFF"], ["kitchen@stallorder.test", "KITCHEN"]] as const) {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { email } });
    if (role === "ORGANIZATION_OWNER") await prisma.organizationMembership.create({ data: { organizationId, profileId: profile.id, role, allStalls: true, isPrimaryOwner: false } });
    if (role !== "ORGANIZATION_OWNER") await prisma.stallMembership.create({ data: { organizationId, stallId, profileId: profile.id, role } });
  }
  const category = await prisma.productCategory.create({ data: { organizationId, name: "QA 炸物" } });
  const product = await prisma.product.create({ data: { organizationId, categoryId: category.id, name: "尖峰驗收餐", defaultPrice: 50, description: "保留供店員與廚房操作", stallProducts: { create: { organizationId, stallId, isEnabled: true, stockRemaining: 100 } } } });
  const station = await prisma.kitchenStation.create({ data: { organizationId, stallId, code: "QA", name: "QA 製餐區" } });
  await prisma.kitchenStationAssignment.create({ data: { organizationId, stallId, stationId: station.id, productId: product.id } });
  await prisma.stallBusinessHour.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId, stallId, dayOfWeek, opensAt: "00:00", closesAt: "23:59", isClosed: false })) });
  await prisma.stallOrderingSettings.create({ data: { organizationId, stallId, kdsModuleEnabled: true, paymentModuleEnabled: true, takeoutPreorderEnabled: true, preorderMinLeadMinutes: 5, enabledLocales: ["zh-TW"] } });
  const circuitFlag = await prisma.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "DUAL_ORDER_INTAKE_ENABLED" } });
  circuitOverrideId = (await prisma.resilienceFeatureFlagOverride.create({ data: { flagId: circuitFlag.id, scopeType: "GLOBAL", enabled: true, reason: "Local retained capacity scenario", createdByProfileId: owner.id, updatedByProfileId: owner.id } })).id;
  await prisma.stallCapacitySettings.update({ where: { stallId }, data: { manualWaitMinutes: null, maxOrdersPerWindow: 5, maxItemsPerWindow: 20, windowMinutes: 15, defaultPrepMinutes: 10, quoteBufferMinutes: 3, autoPauseEnabled: true, autoResumeEnabled: true, isActive: true } });
  const qrToken = "qa-surge-" + randomUUID();
  await prisma.qrCode.create({ data: { organizationId, stallId, token: qrToken, tokenVersion: 1, label: "QA 尖峰", state: "ACTIVE" } });
  await establishLocalTestSession(page, prisma, owner.id);
  const headers = { origin: app, "x-csrf-token": (await page.context().cookies()).find(row => row.name === "stallorder_csrf")!.value };
  const api: APIRequestContext = page.request;
  async function patch(path: string, data: object) {
    const response = await api.patch(path, { headers, data });
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(200);
    return body;
  }
  const snapshots: Array<{ stage: string; snapshot: Prisma.JsonValue }> = [];
  async function snapshot(stage: string, automate = true) {
    const [row] = await prisma.$queryRaw<Array<{ snapshot: Prisma.JsonValue }>>(Prisma.sql`select public.refresh_stall_capacity(${stallId}::uuid, ${automate}, ${"LOCAL_QA_" + stage}) as snapshot`);
    snapshots.push({ stage, snapshot: row.snapshot });
    return row.snapshot as Record<string, number | string | boolean>;
  }
  function publicHeaders(index: number) {
    return { origin: app, "x-stallorder-protocol-version": "1", "x-stallorder-operation-id": randomUUID(), "cf-connecting-ip": "198.18.91." + index, "x-vercel-forwarded-for": "198.18.91." + index };
  }
  async function session(index: number, mode = "DEFAULT") {
    const deviceId = randomUUID(), requestHeaders = publicHeaders(index);
    const response = await api.post("/api/public/order-session", { headers: requestHeaders, data: { qrToken, deviceId, orderingMode: mode, sessionRequestId: randomUUID() } });
    return { response, deviceId, headers: requestHeaders, body: await response.json() };
  }
  const base = await snapshot("empty");
  expect(base.order_count).toBe(0);
  const orders: Array<{ id: string; data: object; headers: Record<string, string> }> = [];
  for (let index = 1; index <= 12; index++) {
    const issued = await session(index);
    expect(issued.response.status(), JSON.stringify(issued.body)).toBe(201);
    const data = { qrToken, deviceId: issued.deviceId, orderingMode: "DEFAULT", orderSessionToken: issued.body.orderSessionToken,
      clientOrderId: randomUUID(), idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      customerName: "尖峰範例 " + index, customerNote: "本機保留範例，供店員與廚房流程測試", waitAcknowledged: true, items: [{ productId: product.id, quantity: 4 }] };
    const response = await api.post("/api/public/orders", { headers: issued.headers, data });
    expect(response.status(), JSON.stringify(await response.json())).toBe(201);
    orders.push({ id: data.clientOrderId, data, headers: issued.headers });
  }
  await prisma.order.updateMany({ where: { id: { in: orders.map(order => order.id) } }, data: { isTest: true } });
  const heldSession = await session(13);
  expect(heldSession.response.status()).toBe(201);
  for (const order of orders.slice(0, 3)) await patch(`/api/stalls/${slug}/orders/${order.id}`, { status: "CONFIRMED" });
  const busy = await snapshot("three-confirmed");
  expect(busy.order_count).toBe(3);
  expect(busy.quote_min_minutes).toBeGreaterThan(Number(base.quote_min_minutes));
  expect(busy.accepting_public_orders).toBe(true);
  for (const order of orders.slice(3, 5)) await patch(`/api/stalls/${slug}/orders/${order.id}`, { status: "CONFIRMED" });
  const full = await snapshot("five-confirmed");
  expect(full.utilization_percent).toBe(100);
  expect(full.accepting_public_orders).toBe(false);
  expect((await prisma.stallCapacitySettings.findUniqueOrThrow({ where: { stallId } })).pauseSource).toBe("AUTO");
  const beforeCount = await prisma.order.count({ where: { stallId } });
  const blocked = await api.post("/api/public/orders", { headers: heldSession.headers, data: { ...orders[0].data, clientOrderId: randomUUID(), idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(), deviceId: heldSession.deviceId, orderSessionToken: heldSession.body.orderSessionToken } });
  expect([403, 409]).toContain(blocked.status());
  expect((await blocked.json()).code).toMatch(/ORDERING|CAPACITY|STALL/);
  expect(await prisma.order.count({ where: { stallId } })).toBe(beforeCount);
  async function ready(id: string) {
    const tasks = await prisma.orderProductionTask.findMany({ where: { orderId: id } });
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      await patch(`/api/stalls/${slug}/kitchen/tasks`, { operation: "UPDATE_TASK", taskId: task.id, status: "PREPARING" });
      await patch(`/api/stalls/${slug}/kitchen/tasks`, { operation: "UPDATE_TASK", taskId: task.id, status: "COMPLETED" });
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
  }
  for (const order of orders.slice(0, 3)) await ready(order.id);
  const recovered = await snapshot("three-ready");
  expect(recovered.order_count).toBe(2);
  expect(recovered.accepting_public_orders).toBe(true);
  expect(recovered.quote_min_minutes).toBeLessThan(Number(full.quote_min_minutes));
  await patch(`/api/stalls/${slug}/capacity`, { operation: "PAUSE_ORDERING", reason: "QA 人工暫停不應自動恢復" });
  for (const order of orders.slice(3, 5)) await ready(order.id);
  expect((await snapshot("manual-pause-empty")).accepting_public_orders).toBe(false);
  expect((await prisma.stallCapacitySettings.findUniqueOrThrow({ where: { stallId } })).pauseSource).toBe("MANUAL");
  await patch(`/api/stalls/${slug}/capacity`, { operation: "RESUME_ORDERING", reason: "QA 人工確認恢復營業" });
  await patch(`/api/stalls/${slug}/ordering`, { action: "CLOSE" });
  expect((await snapshot("closed")).accepting_public_orders).toBe(false);
  const closed = await session(14);
  expect([403, 409]).toContain(closed.response.status());
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, "/q/" + qrToken);
  await expect(page.getByRole("heading", { name: "目前無法使用此 QR Code", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("攤位目前暫停或關閉點餐");
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("closed-qr-message.png") });
  await patch(`/api/stalls/${slug}/ordering`, { action: "OPEN" });
  expect((await session(15)).response.status()).toBe(201);
  await patch(`/api/stalls/${slug}/orders/${orders[5].id}`, { status: "CONFIRMED" });
  const stored = await prisma.order.findMany({ where: { stallId }, orderBy: { createdAt: "asc" }, select: { id: true, orderNo: true, status: true, customerName: true, paymentStatus: true, total: true, isTest: true } });
  await prisma.order.updateMany({ where: { stallId, status: "WAITING_CONFIRMATION" }, data: { confirmationExpiresAt: new Date(Date.now() + 86400_000) } });
  expect((await prisma.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId, productId: product.id } } })).stockRemaining).toBe(52);
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoLocalPath(page, "/staff/" + slug);
    await dismissStaffStartReminder(page);
    await expect(page.getByTestId("staff-order-list-pane")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("surge-staff-" + width + ".png") });
    await gotoLocalPath(page, "/kitchen?stall=" + slug);
    await expect(page.locator("body")).toContainText("尖峰驗收餐");
    await page.screenshot({ path: test.info().outputPath("surge-kitchen-" + width + ".png") });
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/local-surge-orders-20260907.json", JSON.stringify({ testedAt: new Date().toISOString(), environment: app, organizationId, stallId, slug, staff: app + "/staff/" + slug, kitchen: app + "/kitchen?stall=" + slug, snapshots, orders: stored }, null, 2) + "\n");
});
