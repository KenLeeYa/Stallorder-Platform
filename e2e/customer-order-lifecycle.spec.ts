import { createHash, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderIds: string[] = [];
const qrToken = "customer-lifecycle-" + randomUUID();
let qrId = "";
let productId = "";
let circuitFlagOverrideId = "";
let originalHours: Array<{ id: string; opensAt: string; closesAt: string; isClosed: boolean }> = [];

test.use({ serviceWorkers: "block" });
test.beforeAll(async () => {
  if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname)) {
    throw new Error("LOCAL_CUSTOMER_LIFECYCLE_TEST_ONLY");
  }
  const flag = await prisma.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "DUAL_ORDER_INTAKE_ENABLED" }, select: { id: true } });
  circuitFlagOverrideId = (await prisma.resilienceFeatureFlagOverride.create({ data: {
    flagId: flag.id, scopeType: "GLOBAL", enabled: true,
    reason: "Isolated customer lifecycle Circuit B regression",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  } })).id;
  originalHours = await prisma.stallBusinessHour.findMany({
    where: { stallId }, select: { id: true, opensAt: true, closesAt: true, isClosed: true },
  });
  await prisma.stallBusinessHour.updateMany({ where: { stallId }, data: { opensAt: "00:00", closesAt: "23:59", isClosed: false } });
  const version = await prisma.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } });
  qrId = (await prisma.qrCode.create({ data: {
    organizationId, stallId, token: qrToken, label: "customer lifecycle regression", state: "ACTIVE",
    tokenVersion: (version._max.tokenVersion ?? 0) + 1,
  } })).id;
  const category = await prisma.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true }, select: { id: true } });
  productId = (await prisma.product.create({ data: {
    organizationId, categoryId: category.id, name: "取餐時間測試餐 " + randomUUID().slice(0, 8),
    kind: "SINGLE", description: "本機流程測試", defaultPrice: 50, isActive: true,
    stallProducts: { create: { organizationId, stallId, isEnabled: true, isSoldOut: false } },
  } })).id;
});
test.afterAll(async () => {
  try {
    if (circuitFlagOverrideId) await prisma.resilienceFeatureFlagOverride.deleteMany({ where: { id: circuitFlagOverrideId } });
    const sessions = await prisma.orderSession.findMany({ where: { qrCodeId: qrId }, select: { id: true } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId: qrId } });
    await prisma.orderSession.deleteMany({ where: { id: { in: sessions.map(x => x.id) } } });
    if (qrId) await prisma.qrCode.delete({ where: { id: qrId } });
    if (productId) {
      await prisma.stallProduct.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
    for (const { id, ...data } of originalHours) await prisma.stallBusinessHour.update({ where: { id }, data });
  } finally { await prisma.$disconnect(); }
});

for (const mode of ["DEFAULT", "PREORDER"] as const) {
  test(mode + ": three edits, proposal responses, device binding and confirmed-order lock", async ({ page, playwright }) => {
    test.setTimeout(150_000);
    const origin = new URL(test.info().project.use.baseURL as string).origin;
    const trustedIp = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": trustedIp, "x-vercel-forwarded-for": trustedIp });
    const headers = { origin, "content-type": "application/json", "x-stallorder-protocol-version": "1", "x-stallorder-operation-id": randomUUID(),
      "cf-connecting-ip": trustedIp, "x-vercel-forwarded-for": trustedIp };
    const deviceId = randomUUID();
    const sessionResponse = await page.request.post("/api/public/order-session", {
      headers, data: { qrToken, deviceId, orderingMode: mode, sessionRequestId: randomUUID() },
    });
    expect(sessionResponse.status()).toBe(201);
    const session = await sessionResponse.json();
    const slots = (session.preorderSlots ?? []) as string[];
    const orderId = randomUUID();
    orderIds.push(orderId);
    const create = await page.request.post("/api/public/orders", { headers, data: {
      qrToken, deviceId, orderingMode: mode, orderSessionToken: session.orderSessionToken,
      clientOrderId: orderId, idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(),
      customerName: "流程回歸測試", customerPhone: "0912345678", waitAcknowledged: true,
      scheduledPickupAt: mode === "PREORDER" ? slots[4] : null,
      items: [{ productId, quantity: 1 }], turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    } });
    expect(create.status(), JSON.stringify(await create.json())).toBe(201);
    const created = await create.json();
    const trackingToken = created.trackingToken as string;
    const publicPath = "/api/public/orders/" + trackingToken;
    const edit = { deviceId, idempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
      customerName: "流程回歸測試", customerPhone: "0912345678", items: [{ productId, quantity: 1 }] };
    for (const quantity of [1, 2, 2]) {
      const result = await page.request.patch(publicPath, { headers, data: {
        ...edit, idempotencyKey: randomUUID(), items: [{ productId, quantity }],
      } });
      expect(result.status(), JSON.stringify(await result.json())).toBe(200);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { items: { select: { quantity: true } }, status: true } });
      expect(stored.items).toEqual([{ quantity }]);
      expect(stored.status).toBe("WAITING_CONFIRMATION");
    }
    expect(await prisma.order.count({ where: { trackingTokenHash: createHash("sha256").update(trackingToken).digest("hex") } })).toBe(1);
    await prisma.stallProduct.updateMany({ where: { stallId, productId }, data: { isSoldOut: true } });
    try {
      const unavailable = await page.request.patch(publicPath, { headers, data: { ...edit, idempotencyKey: randomUUID() } });
      expect((await unavailable.json()).code).toBe("PRODUCT_UNAVAILABLE");
      expect(unavailable.ok()).toBe(false);
      expect((await prisma.orderItem.findMany({ where: { orderId }, select: { quantity: true } }))).toEqual([{ quantity: 2 }]);
    } finally {
      await prisma.stallProduct.updateMany({ where: { stallId, productId }, data: { isSoldOut: false } });
    }

    const staff = await playwright.request.newContext({ baseURL: origin });
    try {
      const login = await staff.post("/api/auth/login", { headers, data: { email: "staff@stallorder.test", password: "StallOrderDemo!2026" } });
      expect(login.status()).toBe(200);
      const staffCookies = (await staff.storageState()).cookies;
      const csrf = staffCookies.find(x => x.name === "stallorder_csrf")?.value;
      // Production cookies stay Secure; this isolated HTTP API harness forwards its own login cookies explicitly.
      const staffHeaders = { ...headers, "x-csrf-token": csrf!, cookie: staffCookies.map(x => `${x.name}=${x.value}`).join("; ") };
      const staffPath = "/api/stalls/aming-chicken/orders/" + orderId;
      await page.context().addCookies([{ name: "stallorder_device", value: deviceId, url: origin }]);
      await page.setViewportSize({ width: 390, height: 844 });

      if (mode === "PREORDER") {
        await propose(staff, staffPath, staffHeaders, 1, slots[5]);
        await page.goto("/order/" + trackingToken);
        await expect(page.getByRole("button", { name: /無法接受/ })).toBeVisible();
        const declineResponse = page.waitForResponse(x => x.url().endsWith("/fulfillment-time") && x.request().method() === "POST");
        await page.getByRole("button", { name: /無法接受/ }).click();
        expect((await declineResponse).status()).toBe(200);
        await expect(page.getByText(/已通知店家此時間無法配合/)).toBeVisible();
        const replay = await page.request.post(publicPath + "/fulfillment-time", { headers, data: { deviceId, version: 2, response: "DECLINE" } });
        expect(replay.status()).toBe(409);
        expect((await replay.json()).code).toBe("FULFILLMENT_TIME_PROPOSAL_STALE");
        expect(await prisma.orderEvent.count({ where: { orderId, eventType: "FULFILLMENT_TIME_DECLINED" } })).toBe(1);
        await propose(staff, staffPath, staffHeaders, 2, slots[6]);
        const wrongDevice = await page.request.post(publicPath + "/fulfillment-time", { headers, data: { deviceId: randomUUID(), version: 3, response: "ACCEPT" } });
        expect(wrongDevice.status()).toBe(404);
        const stale = await page.request.post(publicPath + "/fulfillment-time", { headers, data: { deviceId, version: 2, response: "ACCEPT" } });
        expect(stale.status()).toBe(409);
        await page.reload();
        const acceptButton = page.getByRole("button", { name: "接受新取餐時間", exact: true });
        await expect(acceptButton).toBeVisible();
        const acceptance = page.waitForResponse(x => x.url().endsWith("/fulfillment-time") && x.request().method() === "POST");
        await acceptButton.click();
        expect((await acceptance).status()).toBe(200);
        const accepted = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
        expect(accepted.committedFulfillmentAt?.getTime()).toBe(new Date(slots[6]).getTime());
        expect(accepted.requestedFulfillmentAt?.getTime()).toBe(new Date(slots[4]).getTime());

        if (process.env.LOCAL_CANONICAL_DRIFT_TEST === "true") {
          for (const [version, response] of [[3, "DECLINE"], [4, "ACCEPT"]] as const) {
            await propose(staff, staffPath, staffHeaders, version, slots[7]);
            const output = execFileSync(process.execPath, [
              "--conditions=react-server", "--env-file=.env.local", "--env-file=supabase/functions/e2e-runtime.defaults",
              "--import", "tsx", "e2e/fixtures/fulfillment-time-drift-runner.ts",
            ], { input: JSON.stringify({ trackingToken, deviceId, version: version + 1, response, origin }), encoding: "utf8", timeout: 20_000, windowsHide: true });
            const result = JSON.parse(output.split("__RESULT__").at(-1)!);
            expect(result.status, JSON.stringify(result.body)).toBe(200);
          }
        }
      }
      const confirmed = await staff.patch(staffPath, { headers: staffHeaders, data: { status: "CONFIRMED" } });
      expect(confirmed.status(), JSON.stringify(await confirmed.json())).toBe(200);
      const locked = await page.request.patch(publicPath, { headers, data: { ...edit, turnstileToken: "invalid-challenge" } });
      expect(locked.status()).toBe(409);
      expect((await locked.json()).code).toBe("ORDER_ALREADY_CONFIRMED");
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/order/" + trackingToken);
        await page.getByRole("button", { name: "修改訂單", exact: true }).click();
        await expect(page.getByRole("alertdialog")).toContainText("商家已確認訂單，無法修改訂單");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: test.info().outputPath("confirmed-" + width + ".png"), fullPage: true });
      }
    } finally { await staff.dispose(); }
  });
}

async function propose(staff: APIRequestContext, path: string, headers: Record<string, string>, version: number, at: string) {
  const result = await staff.patch(path + "/fulfillment-time", { headers, data: {
    operation: "PROPOSE", version, proposedFulfillmentAt: new Date(at).toISOString(), reason: "回歸測試：調整取餐時間",
  } });
  expect(result.status(), JSON.stringify(await result.json())).toBe(200);
}
