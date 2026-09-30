import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createResponsiveOrderFixture } from "./helpers/responsive-order-fixture";
import { readResponsiveBuildProvenance } from "../scripts/responsive-build-provenance.mjs";
import { kitchenProps, mountKitchenBoard, updateKitchenBoard } from "./helpers/mounted-kitchen-board";
import { addFirstStaffCatalogProduct, dismissStaffStartReminder, continueQrCheckout, qrProductSelectionControl, loginLocalTestAccount } from "./local-navigation";

test.use({ serviceWorkers: "block" });

for (const fulfillmentType of ["TAKEOUT", "DELIVERY"] as const) test(`RSP-Q09: mobile staff edits ${fulfillmentType} items before confirmation and customer sees same-order adjustment`, async ({ page, browser }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  const customer = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    const category = await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { categoryId: true } });
    const products = [];
    for (const [label, price] of [["主餐", 80], ["配菜", 30]] as const) products.push(await prisma.product.create({ data: {
      organizationId: fixture.organizationId, categoryId: category.categoryId, name: `A6 ${label} ${fixture.runId.slice(0, 8)}`, description: "Owned amendment fixture", defaultPrice: price,
      stallProducts: { create: { organizationId: fixture.organizationId, stallId: fixture.stallId, isEnabled: true, stockRemaining: 97 } },
    } }));
    const initialStock = await prisma.stallProduct.findMany({ where: { stallId: fixture.stallId, productId: { in: products.map((product) => product.id) } } });
    expect(initialStock.map((row) => row.stockRemaining)).toEqual([97, 97]);
    const deviceId = randomUUID(), trackingToken = `sto_${randomBytes(32).toString("base64url")}`;
    // Authorized order fixture, not evidence of a LINE/provider delivery intake.
    const order = await prisma.order.create({ data: {
      organizationId: fixture.organizationId, stallId: fixture.stallId, orderNo: `A6-${fixture.runId.slice(0, 8)}`, idempotencyKey: randomUUID(),
      trackingTokenHash: createHash("sha256").update(trackingToken).digest("hex"), deviceHash: createHmac("sha256", process.env.ABUSE_HASH_SECRET!.trim()).update(`device:${deviceId}`).digest("hex"),
      source: fulfillmentType === "DELIVERY" ? "LINE_DELIVERY" : "QR_MENU", fulfillmentType, origin: "ONLINE_QR", isTest: true,
      customerName: `A6 ${fulfillmentType} amendment`, customerPhone: "0912345678", deliveryAddress: fulfillmentType === "DELIVERY" ? "本機測試地址，請勿外送" : null,
      status: "WAITING_CONFIRMATION", subtotal: 190, total: 190, confirmationExpiresAt: new Date(Date.now() + 86_400_000),
      items: { create: products.map((product, index) => ({ organizationId: fixture.organizationId, stallId: fixture.stallId, productId: product.id, sourceLineIndex: index + 1, name: product.name, quantity: index === 0 ? 2 : 1, baseUnitPrice: product.defaultPrice, unitPrice: product.defaultPrice, status: "PENDING" })) },
    } });
    const reservedStock = await prisma.stallProduct.findMany({ where: { stallId: fixture.stallId, productId: { in: products.map((product) => product.id) } } });
    // Deferred reconcile_order_stock reserves the inserted item quantities.
    for (const [index, product] of products.entries()) expect(reservedStock.find((row) => row.productId === product.id)?.stockRemaining)
      .toBe(initialStock.find((row) => row.productId === product.id)!.stockRemaining! - (index === 0 ? 2 : 1));
    await page.setViewportSize({ width: 390, height: 844 });
    await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
    await page.goto(`/staff/${fixture.stallSlug}`);
    await dismissStaffStartReminder(page);
    await page.getByTestId("staff-search-open").click();
    const search = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
    await search.getByRole("searchbox").fill(order.orderNo);
    await search.getByRole("button", { name: "確認", exact: true }).click();
    const ticket = page.getByRole("article").filter({ hasText: order.orderNo });
    await ticket.getByRole("button", { name: "查看明細", exact: true }).click();
    await page.getByRole("dialog", { name: `訂單 ${order.orderNo}` }).getByRole("button", { name: "修改訂單內容", exact: true }).click();
    const editor = page.getByRole("dialog").filter({ has: page.locator("#order-edit-title") });
    await editor.getByRole("button", { name: `減少 ${products[0].name} 數量`, exact: true }).click();
    await editor.locator(".divide-y > div").filter({ hasText: products[1].name }).getByRole("button", { name: "移除", exact: true }).click();
    const notice = `配菜售完，主餐保留一份 ${fixture.runId.slice(0, 8)}`;
    await editor.getByRole("textbox").fill("");
    await expect(editor.getByRole("button", { name: "儲存並同步廚房", exact: true })).toBeDisabled();
    await editor.getByRole("textbox").fill(notice);
    const saving = page.waitForResponse((response) => response.url().endsWith(`/${order.id}/content`) && response.request().method() === "PATCH");
    await editor.getByRole("button", { name: "儲存並同步廚房", exact: true }).click();
    expect((await saving).status()).toBe(200);
    await expect(editor).toBeHidden();
    const adjusted = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, events: true } });
    expect(adjusted).toMatchObject({ orderNo: order.orderNo, total: 80, status: "WAITING_CONFIRMATION", paymentStatus: "UNPAID" });
    expect(adjusted.items).toHaveLength(1);
    expect(adjusted.items[0]).toMatchObject({ productId: products[0].id, quantity: 1, unitPrice: 80 });
    expect(adjusted.events.filter((event) => event.eventType === "PUBLIC_ORDER_ITEMS_ADJUSTED")).toHaveLength(1);
    for (const before of reservedStock) expect((await prisma.stallProduct.findUniqueOrThrow({ where: { id: before.id } })).stockRemaining).toBe(before.stockRemaining! + 1);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
    await customer.addCookies([{ name: "stallorder_device", value: deviceId, url: process.env.PLAYWRIGHT_APP_URL! }]);
    const tracker = await customer.newPage();
    await tracker.goto(`/order/${trackingToken}`);
    await expect(tracker.getByText(notice, { exact: true })).toBeVisible();
    const adjustment = tracker.getByRole("dialog", { name: "訂單內容已由店家調整", exact: true });
    await expect(adjustment).toContainText("$190");
    await expect(adjustment).toContainText("$80");
    await adjustment.getByRole("button", { name: "我知道了", exact: true }).last().click();
    await expect(tracker.getByRole("main")).toContainText(`1 × ${products[0].name}`);
    await expect(tracker.getByRole("main")).not.toContainText(products[1].name);
    await ticket.getByRole("button", { name: "查看明細", exact: true }).click();
    const confirmed = page.waitForResponse((response) => response.url().endsWith(`/orders/${order.id}`) && response.request().method() === "PATCH");
    await page.getByRole("dialog", { name: `訂單 ${order.orderNo}` }).getByRole("button", { name: "確認接單", exact: true }).click();
    expect((await confirmed).status()).toBe(200);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { productionTask: true } } } });
    expect(final).toMatchObject({ orderNo: order.orderNo, total: 80, status: "CONFIRMED", paymentStatus: "UNPAID" });
    expect(final.items).toHaveLength(1);
    expect(final.items[0].productionTask).toMatchObject({ quantity: 1, status: "PENDING" });
    expect(await prisma.order.count({ where: { idempotencyKey: order.idempotencyKey } })).toBe(1);
  } finally { await customer.close(); await prisma.$disconnect(); }
});

test("RSP-Q05: real session revocation 401 and shared-device finance identity 403 clear old kitchen data", async ({ page, request }) => {
  test.setTimeout(90_000);
  const prisma = new PrismaClient();
  let profileId = "";
  try {
    const { order } = await createEdgeOrder(request, prisma);
    const saved = await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED", confirmedAt: new Date() }, include: { items: true } });
    const station = await prisma.kitchenStation.findFirstOrThrow({ where: { stallId: saved.stallId, isActive: true } });
    await prisma.orderProductionTask.upsert({ where: { orderItemId: saved.items[0].id }, update: {}, create: { organizationId: saved.organizationId, stallId: saved.stallId, orderId: saved.id, orderItemId: saved.items[0].id, stationId: station.id, quantity: 1 } });
    await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
    await page.goto("/kitchen?stall=aming-chicken");
    await page.getByTestId("kitchen-mode-order").click();
    await expect(page.getByRole("button").filter({ hasText: `#${saved.orderNo}` })).toBeVisible();
    await page.getByTestId("kitchen-mode-station").click();
    await expect(page.getByRole("combobox").filter({ has: page.getByRole("option", { name: station.name, exact: true }) })).toBeVisible();
    const cookie = (await page.context().cookies()).find((c) => c.name === "stallorder_session")!;
    await prisma.authSession.update({ where: { tokenHash: createHash("sha256").update(cookie.value).digest("hex") }, data: { revokedAt: new Date(), revokeReason: "A6 owned test revocation" } });
    const revoked = page.waitForResponse((r) => r.url().endsWith("/kitchen/board") && r.status() === 401);
    await page.getByTestId("kitchen-refresh-control").click();
    expect((await revoked).status()).toBe(401);
    await expect(page.getByRole("alert").filter({ hasText: "權限已失效" })).toBeVisible();
    await expect(page.getByText(`#${saved.orderNo}`, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: station.name, exact: true })).toHaveCount(0);
    const owner = await prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
    const finance = await prisma.profile.create({ data: { email: `recovery-${randomUUID()}@stallorder.test`, displayName: "A6 recovery finance", passwordHash: owner.passwordHash,
      organizationMemberships: { create: { organizationId: saved.organizationId, role: "FINANCE_VIEWER", allStalls: true } } } });
    profileId = finance.id;
    const signedIn = await page.context().request.post("/api/auth/login", { headers: { origin: process.env.PLAYWRIGHT_APP_URL! }, data: { email: finance.email, password: "StallOrderDemo!2026" } });
    expect(signedIn.status()).toBe(200);
    const denied = page.waitForResponse((r) => r.url().endsWith("/kitchen/board") && r.status() === 403);
    await page.getByTestId("kitchen-refresh-control").click();
    expect((await denied).status()).toBe(403);
    await expect(page.getByRole("alert").filter({ hasText: "權限已失效" })).toBeVisible();
    await expect(page.getByText(`#${saved.orderNo}`, { exact: true })).toHaveCount(0);
    const direct = await page.evaluate(async () => { const r = await fetch("/api/stalls/aming-chicken/kitchen/board"); return { status: r.status, body: await r.text() }; });
    expect(direct.status).toBe(403);
    expect(direct.body).not.toContain(saved.orderNo);
    expect(direct.body).not.toContain(saved.id);
  } finally {
    if (profileId) await prisma.profile.delete({ where: { id: profileId } });
    await prisma.$disconnect();
  }
});

for (const lostResponses of [1, 2, "recovery-500", "first-corrupt", "first-offline", "first-body-read", "first-503", "first-null"] as const) test(`RSP-Q03: ${lostResponses} accepted cash response losses resume original order before synthetic print retry`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const prisma = new PrismaClient();
  let orderId = "";
  let jobId = "";
  const identities: string[] = [];
  const payloads: string[] = [];
  let accepted: { paymentId: string; usage: number; orderNo: string } | undefined;
  const fixture = await createResponsiveOrderFixture(prisma);
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: fixture.stallId }, select: { printModuleEnabled: true, kdsModuleEnabled: true } });
  try {
    await prisma.stallOrderingSettings.update({ where: { stallId: fixture.stallId }, data: { printModuleEnabled: false, kdsModuleEnabled: false } });
    if (lostResponses === "first-body-read") await page.addInitScript(() => {
      const originalFetch = window.fetch;
      let consumed = false;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (!consumed && args[1]?.method === "POST" && String(args[0]).endsWith("/api/stalls/aming-chicken/orders") && response.status === 201) {
          consumed = true;
          await response.text(); // Real Response.json now rejects with body-used TypeError.
        }
        return response;
      };
    });
    await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/staff/${fixture.stallSlug}`);
    await dismissStaffStartReminder(page);
    await page.getByRole("button", { name: "店員點餐", exact: true }).click();
    const pos = page.getByRole("dialog", { name: "店員點餐", exact: true });
    await addFirstStaffCatalogProduct(page, pos);
    await pos.getByTestId("staff-order-cart-tab").click();
    await pos.getByTestId("staff-tablet-confirm-order").click();
    await page.route(`**/api/stalls/${fixture.stallSlug}/orders`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      identities.push(route.request().postDataJSON().idempotencyKey);
      payloads.push(route.request().postData()!);
      const response = await route.fetch();
      if (!accepted) {
        expect(response.status()).toBe(201);
        const payload = await response.json();
        orderId = payload.order.id;
        const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
        accepted = { paymentId: payment.id, orderNo: payload.order.orderNo, usage: await prisma.usageEvent.count({ where: { referenceId: orderId } }) };
        expect(payment.status).toBe("PAID");
        if (lostResponses === "first-corrupt") return route.fulfill({ status: 201, contentType: "application/json", body: '{"order":' });
        if (lostResponses === "first-body-read") return route.fulfill({ response });
        if (lostResponses === "first-null") return route.fulfill({ status: 201, contentType: "application/json", body: "null" });
        if (lostResponses === "first-503") return route.fulfill({ status: 503, contentType: "text/html", body: "<html>Gateway response unavailable</html>" });
        if (lostResponses === "first-offline") await page.context().setOffline(true);
        await route.abort("connectionfailed");
      } else {
        expect(response.status()).toBe(200);
        const replay = await response.json();
        expect(replay).toMatchObject({ idempotent: true, order: { id: orderId } });
        if (lostResponses === "recovery-500" && identities.length === 2) return route.fulfill({ status: 500, contentType: "text/html", body: "<html>Recovery response unavailable</html>" });
        if (typeof lostResponses === "number" && identities.length <= lostResponses) return route.abort("connectionfailed");
        await route.fulfill({ response });
      }
    });
    await pos.getByRole("button", { name: "建立訂單並收款", exact: true }).click();
    await expect.poll(() => Boolean(accepted)).toBe(true);
    await testInfo.attach("accepted-response-loss", { contentType: "application/json", body: JSON.stringify({ orderId, paymentId: accepted!.paymentId, usage: accepted!.usage, fault: "real server accepted PAID; response aborted afterwards" }) });
    // No second user payment confirmation: the UI must resolve the original outcome.
    if (lostResponses !== 1) {
      await expect(pos).toContainText("收款結果尚未確認");
      await expect(pos.getByRole("button", { name: "建立訂單並收款", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(pos).toBeVisible();
      await expect(pos.getByRole("button", { name: "建立訂單並收款", exact: true })).toHaveCount(0);
      expect(identities).toHaveLength(typeof lostResponses === "string" && lostResponses.startsWith("first-") ? 1 : 2);
      if (lostResponses === "first-offline") {
        expect(await page.evaluate(() => navigator.onLine)).toBe(false);
        await page.context().setOffline(false);
      }
      expect(await offlineOrderCount(page)).toBe(0);
      await pos.getByRole("button", { name: "查回原訂單結果", exact: true }).click();
    }
    await expect(pos).toBeHidden({ timeout: 15_000 });
    expect(new Set(identities).size).toBe(1);
    expect(new Set(payloads).size).toBe(1);
    expect(await offlineOrderCount(page)).toBe(0);
    expect(await prisma.order.count({ where: { idempotencyKey: identities[0] } })).toBe(1);
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId } })).id).toBe(accepted!.paymentId);
    await prisma.stallOrderingSettings.update({ where: { stallId: fixture.stallId }, data: { printModuleEnabled: true } });
    jobId = (await prisma.printJob.create({ data: { organizationId: fixture.organizationId, stallId: fixture.stallId, orderId, status: "FAILED", attemptCount: 1, lastError: "A6 synthetic printer offline" } })).id;
    await page.goto(`/staff/${fixture.stallSlug}/print`);
    const job = page.getByRole("article").filter({ hasText: accepted!.orderNo }).filter({ hasText: "A6 synthetic printer offline" });
    await expect(job).toBeVisible();
    const postsBeforePrint = identities.length;
    const retried = page.waitForResponse((r) => r.url().endsWith("/print-jobs") && r.request().postDataJSON()?.operation === "RETRY");
    await job.getByRole("button", { name: "重試", exact: true }).click();
    expect((await retried).status()).toBe(200);
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("PENDING");
    expect(identities).toHaveLength(postsBeforePrint);
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    expect(await prisma.usageEvent.count({ where: { referenceId: orderId } })).toBe(accepted!.usage);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, paymentStatus: true } })).toEqual({ status: "CONFIRMED", paymentStatus: "PAID" });
  } finally {
    await page.context().setOffline(false);
    if (jobId) await prisma.printJob.deleteMany({ where: { id: jobId } });
    await prisma.stallOrderingSettings.update({ where: { stallId: fixture.stallId }, data: settings });
    await prisma.$disconnect();
  }
});

async function offlineOrderCount(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((database) => database.name === "stallorder-offline-pos")) return 0;
    return new Promise<number>((resolve, reject) => {
      const opened = indexedDB.open("stallorder-offline-pos");
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const database = opened.result;
        if (!database.objectStoreNames.contains("offline_orders")) { database.close(); resolve(0); return; }
        const count = database.transaction("offline_orders", "readonly").objectStore("offline_orders").count();
        count.onerror = () => { database.close(); reject(count.error); };
        count.onsuccess = () => { database.close(); resolve(count.result); };
      };
    });
  });
}

async function configuredCart(page: Page, fixture: Awaited<ReturnType<typeof createResponsiveOrderFixture>>) {
  const ip = `198.18.${Number.parseInt(fixture.runId.slice(0, 2), 16)}.${Number.parseInt(fixture.runId.slice(2, 4), 16)}`;
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": ip, "x-vercel-forwarded-for": ip });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/q/${fixture.qrToken}`);
  const name = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
  const product = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await qrProductSelectionControl(product, name).click();
  const config = page.getByTestId("qr-product-configuration");
  await config.getByRole("radio", { name: /QA 必選加料/ }).click();
  await config.getByRole("checkbox", { name: /QA 可選加料/ }).click();
  await config.getByRole("button", { name: "加入購物車", exact: true }).click();
}

async function openCustomerCheckout(page: Page) {
  await page.getByTestId("qr-mobile-cart-summary").click();
  await page.getByTestId("qr-cart-panel").getByRole("button", { name: "繼續填寫訂購資料" }).click();
  await continueQrCheckout(page);
  const acknowledge = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
  if (await acknowledge.isVisible()) await acknowledge.check();
}

test("RSP-Q07: Node fallback 429 Retry-After keeps cart and original retry identity (timing fixture)", async ({ page }) => {
  test.setTimeout(90_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    await configuredCart(page, fixture);
    await openCustomerCheckout(page);
    const identities: string[] = [];
    const fallbackIdentities: string[] = [];
    await page.clock.install();
    await page.route("**/functions/v1/create-public-order", async (route) => {
      identities.push(route.request().postDataJSON().idempotencyKey);
      if (identities.length === 1) return route.fulfill({ status: 500, contentType: "text/html", body: "<html>Owned timing fault</html>" });
      await route.continue();
    });
    await page.route("**/api/public/orders", (route) => {
      fallbackIdentities.push(route.request().postDataJSON().idempotencyKey);
      return route.fulfill({ status: 429, headers: { "retry-after": "30" }, contentType: "application/json", body: JSON.stringify({ code: "RATE_LIMITED" }) });
    });
    const rejected = page.waitForResponse((r) => r.url().endsWith("/api/public/orders") && r.status() === 429);
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    expect((await rejected).headers()["retry-after"]).toBe("30");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "關閉", exact: true }).click();
    const submit = page.getByTestId("qr-checkout-panel").locator("button").last();
    await expect(submit).toBeDisabled();
    await page.clock.fastForward(29_000);
    await expect(submit).toBeDisabled();
    expect(identities).toHaveLength(1);
    expect(fallbackIdentities).toEqual(identities);
    await expect(page.getByTestId("qr-cart-panel")).toContainText("65");
    await page.clock.fastForward(1_100);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/order\/[^/]+$/);
    expect(identities).toHaveLength(2);
    expect(fallbackIdentities).toHaveLength(1);
    expect(new Set(identities).size).toBe(1);
    const orders = await prisma.order.findMany({ where: { idempotencyKey: identities[0] }, include: { payment: true } });
    expect(orders).toHaveLength(1);
    expect(orders[0].total).toBe(65);
    expect(orders[0].payment).toBeNull();
  } finally { await prisma.$disconnect(); }
});

for (const fault of ["HTML500", "timeout"] as const) test(`RSP-Q07: ${fault} on both intake paths preserves draft and retry identity (fault fixture)`, async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    await configuredCart(page, fixture);
    await openCustomerCheckout(page);
    await page.getByLabel("訂單備註", { exact: true }).filter({ visible: true }).fill("恢復後保留");
    const identities: string[] = [];
    let failing = true;
    let failures = 0;
    // Leave real requests pending for the application's AbortSignal timeout.
    // Release held routes only after the visible error; no server mutation occurs.
    const held: import("@playwright/test").Route[] = [];
    for (const endpoint of ["**/functions/v1/create-public-order", "**/api/public/orders"]) {
      await page.route(endpoint, async (route) => {
        identities.push(route.request().postDataJSON().idempotencyKey);
        if (!failing) return route.continue();
        failures += 1;
        if (fault === "timeout") { held.push(route); return; }
        await route.fulfill({ status: 500, contentType: "text/html", body: "<html>Owned recovery fault</html>" });
      });
    }
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    const feedback = page.getByRole("alertdialog");
    await expect(feedback).toContainText(fault === "timeout" ? "網路連線中斷，請稍後再試。" : "目前無法送出訂單", { timeout: 65_000 });
    expect(failures).toBeGreaterThanOrEqual(2);
    await feedback.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(page.getByTestId("qr-cart-panel")).toContainText("65");
    await expect(page.getByLabel("訂單備註", { exact: true }).filter({ visible: true })).toHaveValue("恢復後保留");
    expect(await prisma.order.count({ where: { idempotencyKey: identities[0] } })).toBe(0);
    failing = false;
    for (const route of held) await route.abort().catch(() => {});
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    await expect(page).toHaveURL(/\/order\/[^/]+$/);
    expect(new Set(identities).size).toBe(1);
    const orders = await prisma.order.findMany({ where: { idempotencyKey: identities[0] }, include: { payment: true } });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ total: 65, note: "恢復後保留", payment: null });
  } finally { await prisma.$disconnect(); }
});

test("RSP-Q04: desktop sold-out update rejects old phone cart with PRODUCT_UNAVAILABLE 400 and keeps editable valid line", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    const category = await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId }, select: { categoryId: true } });
    const validName = `有效餐 ${fixture.runId.slice(0, 8)}`;
    await prisma.product.create({ data: { organizationId: fixture.organizationId, categoryId: category.categoryId, name: validName, description: "A6 recovery fixture", defaultPrice: 40,
      stallProducts: { create: { organizationId: fixture.organizationId, stallId: fixture.stallId, isEnabled: true, stockRemaining: 100 } } } });
    await configuredCart(page, fixture);
    await page.getByRole("button", { name: `增加 ${validName}`, exact: true }).click();
    await openCustomerCheckout(page);
    await page.getByLabel("訂單備註", { exact: true }).filter({ visible: true }).fill("保留我的備註");
    const owner = await desktop.newPage();
    await loginLocalTestAccount(owner, "owner@stallorder.test", "StallOrderDemo!2026");
    await owner.goto(`/merchant/catalog?organizationId=${fixture.organizationId}`);
    const board = owner.getByRole("region", { name: "商品批次管理" });
    await board.getByRole("combobox", { name: "管理攤位" }).selectOption(fixture.stallId);
    const name = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
    await board.getByRole("searchbox", { name: "搜尋管理商品" }).fill(name);
    await board.getByRole("checkbox", { name: `選取 ${name}`, exact: true }).check();
    await board.getByRole("button", { name: "批次供應設定", exact: true }).click();
    const availability = owner.getByRole("dialog", { name: "設定供應狀態", exact: true });
    await availability.getByRole("button", { name: /^今日售完/ }).click();
    const marked = owner.waitForResponse((r) => r.url().endsWith("/products") && r.request().method() === "PATCH");
    await availability.getByRole("button", { name: "確認今日售完", exact: true }).click();
    expect((await marked).status()).toBe(200);
    expect((await prisma.stallProduct.findFirstOrThrow({ where: { stallId: fixture.stallId, productId: fixture.productId } })).isSoldOut).toBe(true);
    const rejected = page.waitForResponse((r) => r.url().endsWith("/create-public-order") && r.request().method() === "POST");
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    const response = await rejected;
    expect(await response.json()).toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    expect(response.status()).toBe(400);
    const feedback = page.getByRole("alertdialog");
    await expect(feedback).toContainText("部分商品已售完");
    await feedback.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(page.getByTestId("qr-cart-panel")).toContainText(validName);
    await expect(page.getByLabel("訂單備註", { exact: true }).filter({ visible: true })).toHaveValue("保留我的備註");
    await page.getByLabel("訂單備註", { exact: true }).filter({ visible: true }).fill("仍可修改");
    expect(await prisma.order.count({ where: { items: { some: { productId: fixture.productId } } } })).toBe(0);
  } finally { await desktop.close(); await prisma.$disconnect(); }
});

test("RSP-Q06: real stock-version 409 reloads authority and retains only unchanged product drafts", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    const second = await createResponsiveOrderFixture(prisma);
    const name = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
    const secondName = `跨裝置 QA 餐 ${second.runId.slice(0, 8)}`;
    await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
    await page.goto(`/merchant/catalog?organizationId=${fixture.organizationId}`);
    const board = page.getByRole("region", { name: "商品批次管理" });
    await board.getByRole("combobox", { name: "管理攤位" }).selectOption(fixture.stallId);
    await board.getByRole("button", { name: "全部商品庫存", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /庫存份數/ });
    await dialog.getByRole("spinbutton", { name: `庫存份數 ${name}`, exact: true }).fill("15");
    await dialog.getByRole("spinbutton", { name: `庫存份數 ${secondName}`, exact: true }).fill("25");
    const stock = await prisma.stallProduct.findFirstOrThrow({ where: { stallId: fixture.stallId, productId: fixture.productId } });
    const concurrent = await page.evaluate(async ({ stallId, productId, version }) => {
      const csrf = decodeURIComponent(document.cookie.split("; ").find((c) => c.startsWith("stallorder_csrf="))!.split("=")[1]);
      const response = await fetch(`/api/merchant/stalls/${stallId}/products`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ operation: "BULK_STOCK", items: [{ productId, mode: "SET", quantity: 17, expectedVersion: version }] }) });
      return response.status;
    }, { stallId: fixture.stallId, productId: fixture.productId, version: stock.stockVersion });
    expect(concurrent).toBe(200);
    const conflict = page.waitForResponse((r) => r.url().endsWith("/products") && r.request().method() === "PATCH");
    await dialog.getByRole("button", { name: /^儲存庫存/ }).click();
    const rejected = await conflict;
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "STOCK_CHANGED" });
    await expect(dialog.getByRole("alert")).toContainText("整批未儲存");
    await expect(dialog.getByRole("spinbutton", { name: `庫存份數 ${name}`, exact: true })).toHaveValue("17");
    await expect(dialog.getByRole("spinbutton", { name: `庫存份數 ${secondName}`, exact: true })).toHaveValue("25");
    expect((await prisma.stallProduct.findFirstOrThrow({ where: { stallId: fixture.stallId, productId: second.productId } })).stockRemaining).toBe(100);
    const saved = page.waitForResponse((r) => r.url().endsWith("/products") && r.request().method() === "PATCH");
    await dialog.getByRole("button", { name: /^儲存庫存/ }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toBeHidden();
    expect((await prisma.stallProduct.findUniqueOrThrow({ where: { id: stock.id } })).stockRemaining).toBe(17);
    expect((await prisma.stallProduct.findFirstOrThrow({ where: { stallId: fixture.stallId, productId: second.productId } })).stockRemaining).toBe(25);
  } finally { await prisma.$disconnect(); }
});

async function createEdgeOrder(request: APIRequestContext, prisma: PrismaClient, source: "Edge" | "Node" = "Edge") {
  const fixture = await createResponsiveOrderFixture(prisma);
  const deviceId = randomUUID();
  const idempotencyKey = randomUUID();
  const ip = `198.18.${Number.parseInt(fixture.runId.slice(0, 2), 16)}.${Number.parseInt(fixture.runId.slice(2, 4), 16)}`;
  const headers = {
    origin: process.env.PLAYWRIGHT_APP_URL!,
    "x-stallorder-protocol-version": "1",
    "x-stallorder-operation-id": randomUUID(),
    "cf-connecting-ip": ip,
    "x-vercel-forwarded-for": ip,
  };
  const edge = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1";
  const issued = await request.post(source === "Edge" ? edge + "/create-order-session" : "/api/public/order-session", {
    headers,
    data: { qrToken: fixture.qrToken, deviceId, orderingMode: "DEFAULT", sessionRequestId: randomUUID() },
  });
  const session = await issued.json() as { orderSessionToken?: string; code?: string };
  expect(issued.status(), session.code).toBe(201);
  expect(session.orderSessionToken).toBeTruthy();
  const noteGroups = await prisma.productNoteGroupAssignment.findMany({
    where: { productId: fixture.productId },
    include: { noteGroup: { include: { options: true } } },
  });
  const noteOptionIds = noteGroups.map((assignment) => assignment.noteGroup.options[0].id);
  expect(noteOptionIds).toHaveLength(2);
  const data = {
    qrToken: fixture.qrToken, deviceId, orderingMode: "DEFAULT",
    orderSessionToken: session.orderSessionToken, clientOrderId: randomUUID(), idempotencyKey,
    turnstileIdempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    customerName: "同鍵恢復 QA", customerPhone: "0912345678", waitAcknowledged: true,
    items: [{ productId: fixture.productId, quantity: 1, noteOptionIds }],
  };
  const created = await request.post(source === "Edge" ? edge + "/create-public-order" : "/api/public/orders", { headers, data });
  const payload = await created.json() as { orderNo?: string; trackingToken?: string; code?: string };
  expect(created.status(), payload.code).toBe(201);
  expect(payload.trackingToken).toBeTruthy();
  const order = await prisma.order.findFirstOrThrow({
    where: { idempotencyKey }, select: { id: true, deviceHash: true },
  });
  return { deviceId, idempotencyKey, headers, edge, data, created, payload, order };
}

test("RSP-Q01: a real Edge retry keeps one order, payment and usage identity", async ({ request }, testInfo) => {
  test.setTimeout(120_000);
  readResponsiveBuildProvenance();
  const prisma = new PrismaClient();
  try {
    const { idempotencyKey, headers, edge, data, created, payload, order } = await createEdgeOrder(request, prisma);
    const before = {
      paymentCount: await prisma.payment.count({ where: { orderId: order.id } }),
      usageEventCount: await prisma.usageEvent.count({ where: { referenceId: order.id } }),
    };
    const replay = await request.post(edge + "/create-public-order", {
      headers: { ...headers, "x-stallorder-operation-id": randomUUID() }, data,
    });
    const replayPayload = await replay.json() as { orderNo?: string; trackingToken?: string; code?: string };
    expect(replay.status(), replayPayload.code).toBe(200);
    expect(replayPayload.orderNo).toBe(payload.orderNo);
    expect(replayPayload.trackingToken).toBe(payload.trackingToken);
    const replayOrder = await prisma.order.findFirstOrThrow({ where: { idempotencyKey }, select: { id: true } });
    expect(replayOrder.id).toBe(order.id);
    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(1);
    const after = {
      paymentCount: await prisma.payment.count({ where: { orderId: order.id } }),
      usageEventCount: await prisma.usageEvent.count({ where: { referenceId: order.id } }),
    };
    expect(after.paymentCount).toBe(before.paymentCount);
    expect(after.usageEventCount).toBe(before.usageEventCount);
    await testInfo.attach("idempotent-order-receipt", {
      contentType: "application/json",
      body: JSON.stringify({ orderId: order.id, firstStatus: created.status(), replayStatus: replay.status(), before, after }),
    });
  } finally {
    await prisma.$disconnect();
  }
});

for (const source of ["Edge", "Node"] as const) test(`RSP-Q02: ${source}-created order is readable in both runtimes`, async ({ request }, testInfo) => {
  readResponsiveBuildProvenance();
  const prisma = new PrismaClient();
  try {
    const { deviceId, headers, edge, payload, order } = await createEdgeOrder(request, prisma, source);
    const expectedDeviceHash = createHmac("sha256", process.env.ABUSE_HASH_SECRET!.trim())
      .update(`device:${deviceId}`).digest("hex");
    const edgeRead = await request.post(edge + "/get-public-order", {
      headers, data: { trackingToken: payload.trackingToken, deviceId },
    });
    const nodeRead = await request.get(`/api/public/orders/${payload.trackingToken}`, {
      headers: { ...headers, "x-stallorder-device-id": deviceId },
    });
    await testInfo.attach("cross-runtime-identity-receipt", {
      contentType: "application/json",
      body: JSON.stringify({ orderId: order.id, edgeRead: edgeRead.status(), nodeRead: nodeRead.status(), deviceHashMatchesTestProcess: order.deviceHash === expectedDeviceHash }),
    });
    expect(edgeRead.status(), "Edge should read its created order").toBe(200);
    expect(order.deviceHash === expectedDeviceHash, "Edge order must use the shared device hash").toBe(true);
    expect(nodeRead.status(), "Node should read the Edge-created order").toBe(200);
  } finally {
    await prisma.$disconnect();
  }
});

test("RSP-Q08: same mounted KitchenBoard replaces stall state and ignores late old snapshot (module fixture)", async ({ page }) => {
  const oldProps = kitchenProps("old");
  const nextProps = kitchenProps("next");
  await mountKitchenBoard(page, oldProps);
  await expect(page.getByText("old meal × 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "station", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveValue("old-station");
  await page.getByRole("button", { name: "alerts", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { pendingBoards: object }).pendingBoards))).toContain("/api/stalls/old/kitchen/board");
  await updateKitchenBoard(page, nextProps);
  await expect(page.getByRole("heading", { name: "next kitchen" })).toBeVisible();
  await expect(page.getByText("old meal × 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("next meal × 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "station", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveValue("next-station");
  await expect(page.getByRole("option", { name: "old station" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { pendingBoards: object }).pendingBoards))).toContain("/api/stalls/next/kitchen/board");
  for (const props of [nextProps, oldProps]) {
    await page.evaluate(({ slug, data }) => (window as unknown as { resolveBoard: (slug: string, data: unknown) => void }).resolveBoard(slug, data), { slug: props.stall.slug, data: props.initialData });
  }
  await expect(page.getByText("next meal × 1", { exact: true })).toBeVisible();
  await expect(page.getByText("old meal × 1", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
