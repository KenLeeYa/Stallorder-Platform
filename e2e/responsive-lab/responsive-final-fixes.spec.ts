import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loginLocalTestAccount, dismissStaffStartReminder } from "../local-navigation";
import { searchStaffOrders } from "../helpers/staff-search";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { kitchenProps, mountKitchenBoard } from "../helpers/mounted-kitchen-board";

assertResponsiveQaTarget(process.env);

test.beforeAll(() => assertResponsiveQaTarget(process.env));
test.use({ serviceWorkers: "block" });

test("I2 mounted board404 clears authorized snapshot and recovers after regrant", async ({ page }) => {
  const props = kitchenProps("revoked");
  await mountKitchenBoard(page, props);
  await expect(page.getByText("revoked meal × 1", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { pendingBoards: Record<string, (response: Response) => void> };
    w.pendingBoards["/api/stalls/revoked/kitchen/board"](new Response("{}", { status: 404 }));
  });
  await expect(page.getByText("revoked meal × 1", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert").first()).toContainText("kitchen.board.accessRevoked");
  await page.evaluate((data) => { window.fetch = async () => new Response(JSON.stringify(data), { status: 200 }); }, props.initialData);
  await page.getByRole("button", { name: "refresh", exact: true }).click();
  await expect(page.getByText("revoked meal × 1", { exact: true }).first()).toBeVisible();
});


const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const slug = "aming-chicken";
const password = "StallOrderDemo!2026";
async function fixture() {
  const prisma = new PrismaClient();
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { printModuleEnabled: true, kdsModuleEnabled: true, paymentModuleEnabled: true } });
  await prisma.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: false, kdsModuleEnabled: true, paymentModuleEnabled: true } });
  const category = await prisma.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true } });
  const name = `Final100-${randomUUID().slice(0, 8)}`;
  const product = await prisma.product.create({ data: { organizationId, categoryId: category.id, name, description: "Owned final regression", defaultPrice: 100,
    stallProducts: { create: { organizationId, stallId, isEnabled: true } } } });
  return { prisma, product, settings, async close() {
    await prisma.order.deleteMany({ where: { stallId, items: { some: { productId: product.id } } } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.stallOrderingSettings.update({ where: { stallId }, data: settings });
    await prisma.$disconnect();
  } };
}
async function openPos(page: Page, productName?: string) {
  await page.goto(`/staff/${slug}`); await dismissStaffStartReminder(page);
  await page.getByRole("button", { name: "店員點餐", exact: true }).click();
  const pos = page.getByRole("dialog", { name: "店員點餐", exact: true });
  if (productName) {
    const product = pos.getByTestId("staff-product-card").filter({ hasText: productName });
    await product.getByRole("button", { name: `增加 ${productName}`, exact: true }).click();
    await product.getByRole("button", { name: "加入購物車", exact: true }).click();
    if (page.viewportSize()!.width < 768) await pos.getByTestId("staff-order-cart-tab").click();
  }
  return pos;
}
async function amounts(dialog: Locator) {
  const input = dialog.getByTestId("staff-cash-received-field").getByRole("textbox");
  for (const [received, expected] of [["60", "$40"], ["100", "$0"], ["120", "$20"]]) {
    await input.fill(received);
    await expect(dialog.getByTestId("cash-change-summary").locator("strong")).toHaveText(expected);
  }
}

test("I1 both actual checkout consumers display shortage40 exact0 change20 for100 due", async ({ page }, testInfo) => {
  const f = await fixture();
  try {
    await loginLocalTestAccount(page, "staff@stallorder.test", password);
    await page.setViewportSize({ width: 390, height: 844 });
    const pos = await openPos(page, f.product.name);
    await pos.getByTestId("staff-tablet-confirm-order").click();
    await amounts(pos);
    await pos.getByRole("button", { name: "稍後結帳", exact: true }).click();
    const accepted = page.waitForResponse(r => r.url().endsWith(`/stalls/${slug}/orders`) && r.request().method() === "POST");
    await pos.getByRole("button", { name: "建立訂單送入廚房", exact: true }).click();
    const response = await accepted; expect(response.status()).toBe(201);
    const { order } = await response.json(); expect(order.total).toBe(100);
    await expect(pos).toBeHidden();
    await f.prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
    await f.prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { status: "READY" } });
    await page.reload(); await dismissStaffStartReminder(page); await searchStaffOrders(page, order.orderNo);
    await page.getByTestId("staff-order-mobile-list").getByRole("button", { name: "查看明細", exact: true }).click();
    await page.getByTestId("staff-order-mobile-detail").getByRole("button", { name: "代結帳", exact: true }).click();
    const checkout = page.getByRole("dialog").filter({ has: page.getByTestId("cash-change-summary") });
    await amounts(checkout);
    await page.screenshot({ path: testInfo.outputPath("cash-existing-390.png") });
    await checkout.getByRole("button", { name: "關閉結帳視窗", exact: true }).click();
  } finally { await f.close(); }
});

for (const timing of ["PAY_NOW", "PAY_LATER"] as const) test(`I3 ${timing} lost accepted response reload saved draft reauth and actor isolation`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const f = await fixture(); let posts = 0; let orderId = "", key = "";
  try {
    await loginLocalTestAccount(page, "staff@stallorder.test", password); await page.setViewportSize({ width: 390, height: 844 });
    let pos = await openPos(page, f.product.name);
    await pos.getByTestId("staff-save-draft").click();
    await pos.getByTestId("staff-open-drafts").click();
    await page.getByTestId("staff-draft-card").getByRole("button", { name: "繼續點餐", exact: true }).click();
    await pos.getByTestId("staff-order-cart-tab").click();
    await pos.getByTestId("staff-tablet-confirm-order").click();
    if (timing === "PAY_LATER") await pos.getByRole("button", { name: "稍後結帳", exact: true }).click();
    await page.route(`**/api/stalls/${slug}/orders`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      posts++; key = route.request().postDataJSON().idempotencyKey;
      const response = await route.fetch(); expect(response.status()).toBe(201);
      orderId = (await response.json()).order.id;
      await route.fulfill({ status: 201, contentType: "application/json", body: "null" });
    });
    await pos.getByRole("button", { name: timing === "PAY_NOW" ? "建立訂單並收款" : "建立訂單送入廚房", exact: true }).click();
    await expect(pos).toContainText(timing === "PAY_NOW" ? "收款結果尚未確認" : "建單結果尚未確認");
    expect(posts).toBe(1);
    const count = async () => ({ payments: await f.prisma.payment.count({ where: { orderId } }), usage: await f.prisma.usageEvent.count({ where: { referenceId: orderId } }), print: await f.prisma.printJob.count({ where: { orderId } }) });
    const before = await count(); expect(before.payments).toBe(timing === "PAY_NOW" ? 1 : 0);
    const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("stallorder_staff_order_recovery:")));
    expect(stored).toHaveLength(1);
    const marker = JSON.parse(stored[0][1]);
    expect(Object.keys(marker).sort()).toEqual(["actorProfileId", "cash", "draftId", "idempotencyKey", "organizationId", "paymentTiming", "stallId", "version"].sort());
    expect(marker.idempotencyKey).toBe(key); expect(marker.draftId).toBeTruthy();
    // The saved draft cannot produce another key after reload.
    await page.reload(); pos = await openPos(page);
    await expect(pos).toContainText(timing === "PAY_NOW" ? "收款結果尚未確認" : "建單結果尚未確認");
    await expect(pos.getByTestId("staff-open-drafts")).toBeHidden();
    // Revoke only this test's session, then exercise real login UI with next path.
    const cookie = (await page.context().cookies()).find(c => c.name === "stallorder_session")!;
    await f.prisma.authSession.update({ where: { tokenHash: createHash("sha256").update(cookie.value).digest("hex") }, data: { revokedAt: new Date() } });
    await pos.getByRole("button", { name: "查回原訂單結果", exact: true }).click();
    await expect(pos.getByRole("alert").filter({ hasText: "重新登入" })).toBeVisible();
    await pos.getByRole("link", { name: "以原建單帳號重新登入後查回", exact: true }).click();
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await page.getByLabel("電子郵件").fill("owner@stallorder.test"); await page.getByLabel("密碼", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登入", exact: true }).click(); await page.waitForURL(`**/staff/${slug}`);
    pos = await openPos(page);
    await expect(pos.getByRole("button", { name: "查回原訂單結果", exact: true })).toBeDisabled();
    const denied = await page.evaluate(async ({ actor, key }) => { const r = await fetch(`/api/stalls/aming-chicken/orders/recovery?actorProfileId=${actor}&idempotencyKey=${key}`); return { status: r.status, body: await r.text() }; }, { actor: marker.actorProfileId, key });
    expect(denied.status).toBe(403); expect(denied.body).not.toContain(orderId);
    await pos.getByRole("link", { name: "以原建單帳號重新登入後查回", exact: true }).click();
    await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
    await page.getByLabel("電子郵件").fill("staff@stallorder.test"); await page.getByLabel("密碼", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登入", exact: true }).click(); await page.waitForURL(`**/staff/${slug}`);
    pos = await openPos(page);
    const recovered = page.waitForResponse(r => r.url().includes("/orders/recovery?") && r.status() === 200);
    await pos.getByRole("button", { name: "查回原訂單結果", exact: true }).click();
    expect((await (await recovered).json()).order.id).toBe(orderId); await expect(pos).toBeHidden();
    expect(posts).toBe(1); expect(await count()).toEqual(before);
    expect(await f.prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("stallorder_staff_order_recovery:")))).toEqual([]);
    const drafts = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("stallorder_staff_order_drafts:")));
    expect(drafts.every(([, value]) => !JSON.parse(value).some((d: { id: string }) => d.id === marker.draftId))).toBe(true);
    await testInfo.attach("recovery-counts", { contentType: "application/json", body: JSON.stringify({ timing, orderId, key, posts, before, after: await count() }) });
  } finally { await f.close(); }
});


for (const mode of ["board404", "task404", "task401", "task403", "cancel403", "cancel401"] as const) test(`I2 actual scoped ${mode} quiesces stale board and regrant is explicit`, async ({ page }) => {
  test.setTimeout(90_000);
  const f = await fixture(); let profileId = "";
  try {
    const seed = await f.prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" } });
    const profile = await f.prisma.profile.create({ data: { email: `final-kds-${randomUUID()}@stallorder.test`, displayName: "Final KDS owned", passwordHash: seed.passwordHash } }); profileId = profile.id;
    const membership = await f.prisma.stallMembership.create({ data: { organizationId, stallId, profileId, role: "STALL_MANAGER" } });
    const station = await f.prisma.kitchenStation.findFirstOrThrow({ where: { stallId, isActive: true } });
    const order = await f.prisma.order.create({ data: { organizationId, stallId, orderNo: `F-${randomUUID().slice(0, 8)}`, idempotencyKey: randomUUID(),
      trackingTokenHash: randomUUID(), deviceHash: randomUUID(), source: "STAFF_POS", origin: "ONLINE_QR", fulfillmentType: "TAKEOUT", isTest: true,
      customerName: "Final KDS owned", subtotal: 100, total: 100, status: "CONFIRMED", confirmedAt: new Date(), confirmationExpiresAt: new Date(Date.now() + 3600000),
      items: { create: { organizationId, stallId, productId: f.product.id, name: f.product.name, baseUnitPrice: 100, unitPrice: 100, quantity: 1, status: "PENDING" } } }, include: { items: true } });
    await f.prisma.orderProductionTask.create({ data: { organizationId, stallId, orderId: order.id, orderItemId: order.items[0].id, stationId: station.id, quantity: 1 } });
    await loginLocalTestAccount(page, profile.email!, password); await page.goto(`/kitchen?stall=${slug}`);
    await page.getByTestId("kitchen-mode-order").click(); await page.getByTestId("kitchen-order-queue-button").filter({ hasText: order.orderNo }).click();
    const cancel = mode.startsWith("cancel");
    if (cancel) {
      await page.getByRole("button", { name: "取消", exact: true }).last().click();
      await page.getByRole("dialog").getByRole("textbox").last().fill(order.orderNo);
    }
    if (mode.endsWith("404")) await f.prisma.stallMembership.delete({ where: { id: membership.id } });
    else if (mode.endsWith("401")) {
      const cookie = (await page.context().cookies()).find(c => c.name === "stallorder_session")!;
      await f.prisma.authSession.update({ where: { tokenHash: createHash("sha256").update(cookie.value).digest("hex") }, data: { revokedAt: new Date() } });
    } else await f.prisma.stallMembership.update({ where: { id: membership.id }, data: { role: cancel ? "KITCHEN" : "STAFF" } });
    const expectedStatus = Number(mode.slice(-3));
    const denied = page.waitForResponse(r => r.url().includes(`/api/stalls/${slug}/`) && r.status() === expectedStatus && r.request().method() === (mode === "board404" ? "GET" : "PATCH"));
    if (mode === "board404") await page.getByTestId("kitchen-refresh-control").click();
    else if (cancel) await page.getByRole("dialog").getByRole("button", { name: "確認取消訂單", exact: true }).click();
    else await page.getByRole("button", { name: "開始製作", exact: true }).first().click();
    expect((await denied).status()).toBe(expectedStatus);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (mode === "cancel403") {
      // KITCHEN can still read and update tasks, but cannot cancel; a read200
      // must not restore old manager actions on this mounted page.
      await expect(page.getByRole("link", { name: "重新開啟看板確認操作權限", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "開始製作", exact: true }).first()).toBeDisabled();
    } else {
      await expect(page.getByText(`#${order.orderNo}`, { exact: true })).toHaveCount(0);
      await expect(page.getByText(f.product.name, { exact: false })).toHaveCount(0);
    }
    expect((await f.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CONFIRMED");
    if (mode.endsWith("404")) await f.prisma.stallMembership.create({ data: membership });
    else await f.prisma.stallMembership.update({ where: { id: membership.id }, data: { role: "STALL_MANAGER" } });
    if (mode.endsWith("401")) await loginLocalTestAccount(page, profile.email!, password);
    if (mode === "board404" || mode === "task404") await page.getByTestId("kitchen-refresh-control").click();
    else await page.goto(`/kitchen?stall=${slug}`);
    await page.getByTestId("kitchen-mode-order").click();
    await expect(page.getByTestId("kitchen-order-queue-button").filter({ hasText: order.orderNo })).toBeVisible();
  } finally {
    if (profileId) await f.prisma.profile.delete({ where: { id: profileId } });
    await f.close();
  }
});


test("I2 late pre-denial snapshot cannot repaint and GET200 cannot reenable denied actions", async ({ page }) => {
  const props = kitchenProps("late"); await mountKitchenBoard(page, props);
  await expect(page.getByRole("button", { name: "kitchen.task.start", exact: true })).toBeVisible();
  await page.evaluate((data) => {
    window.fetch = async (_url, init) => init?.method === "PATCH" ? new Response("{}", { status: 403 })
      : new Response(JSON.stringify({ ...data, tasks: [], futureReservations: [], alertOrderIds: [] }));
  }, props.initialData);
  await page.getByRole("button", { name: "kitchen.task.start", exact: true }).click();
  await expect(page.getByText("late meal × 1", { exact: true })).toHaveCount(0);
  await page.evaluate((data) => (window as unknown as { pendingBoards: Record<string, (r: Response) => void> })
    .pendingBoards["/api/stalls/late/kitchen/board"](new Response(JSON.stringify(data))), props.initialData);
  await expect(page.getByText("late meal × 1", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link")).toContainText("kitchen.board.reloadPermissions");
});

test("I2 task resource404 with readable board retains valid read and action access", async ({ page }) => {
  const props = kitchenProps("missing"); await mountKitchenBoard(page, props);
  await page.evaluate((data) => {
    (window as unknown as { pendingBoards: Record<string, (r: Response) => void> }).pendingBoards["/api/stalls/missing/kitchen/board"](new Response(JSON.stringify(data)));
    window.fetch = async (_url, init) => init?.method === "PATCH" ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(data));
  }, props.initialData);
  await page.getByRole("button", { name: "kitchen.task.start", exact: true }).click();
  await expect(page.getByRole("button", { name: "kitchen.task.start", exact: true })).toBeEnabled();
  await expect(page.getByText("missing meal × 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
});

test("I3 nonaccepted or still pending stays UNKNOWN through reload and manual workbench", async ({ page }) => {
  const f = await fixture(); let posts = 0;
  try {
    await loginLocalTestAccount(page, "staff@stallorder.test", password); await page.setViewportSize({ width: 390, height: 844 });
    let pos = await openPos(page, f.product.name); await pos.getByTestId("staff-tablet-confirm-order").click();
    await pos.getByRole("button", { name: "稍後結帳", exact: true }).click();
    await page.route(`**/api/stalls/${slug}/orders`, route => {
      if (route.request().method() !== "POST") return route.continue();
      posts++; return route.abort("connectionfailed"); // No authoritative response; server has no row.
    });
    await pos.getByRole("button", { name: "建立訂單送入廚房", exact: true }).click();
    await expect(pos).toContainText("建單結果尚未確認"); await page.reload(); pos = await openPos(page);
    const readback = page.waitForResponse(r => r.url().includes("/orders/recovery?") && r.status() === 200);
    await pos.getByRole("button", { name: "查回原訂單結果", exact: true }).click();
    expect(await (await readback).json()).toEqual({ status: "UNKNOWN" }); await expect(pos).toContainText("仍無法確認原訂單");
    await expect(pos).toContainText("原交易識別碼");
    await pos.getByRole("link", { name: "回工作台人工核對（保留原交易）", exact: true }).click();
    pos = await openPos(page); await expect(pos).toContainText("建單結果尚未確認");
    await expect(pos.getByRole("button", { name: "建立訂單送入廚房", exact: true })).toHaveCount(0);
    expect(posts).toBe(1);
    expect(await f.prisma.order.count({ where: { items: { some: { productId: f.product.id } } } })).toBe(0);
  } finally { await f.close(); }
});

for (const unavailable of ["storage", "locks", "corrupt"] as const) test(`I3 ${unavailable} unavailable is visible and dispatches no transaction`, async ({ page }) => {
  const f = await fixture(); let posts = 0;
  try {
    await page.addInitScript((mode) => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      if (mode === "locks") Object.defineProperty(navigator, "locks", { value: undefined });
      if (mode === "storage") Storage.prototype.setItem = function(key, value) { if (key.startsWith("stallorder_staff_order_recovery:")) throw new Error("blocked"); return set.call(this, key, value); };
      if (mode === "corrupt") Storage.prototype.getItem = function(key) { return key.startsWith("stallorder_staff_order_recovery:") ? "{" : get.call(this, key); };
    }, unavailable);
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith(`/stalls/${slug}/orders`)) posts++; });
    await loginLocalTestAccount(page, "staff@stallorder.test", password); await page.setViewportSize({ width: 390, height: 844 });
    const pos = await openPos(page, f.product.name); await pos.getByTestId("staff-tablet-confirm-order").click();
    const submit = pos.getByRole("button", { name: "建立訂單並收款", exact: true });
    if (unavailable === "corrupt") await expect(submit).toBeDisabled();
    else await submit.click();
    await expect(pos.getByRole("alert")).toContainText("已停止新的送出"); expect(posts).toBe(0);
  } finally { await f.close(); }
});
