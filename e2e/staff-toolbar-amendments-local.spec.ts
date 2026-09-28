import { test, expect, type Page } from "@playwright/test";
import { PrismaClient, type FulfillmentType } from "@prisma/client";
import { createHash, createHmac, randomUUID } from "node:crypto";

test.skip(process.env.UI_UX_QA !== "true", "Explicit retained local QA only.");
const db = new PrismaClient();
const org = "11111111-1111-4111-8111-111111111111", stall = "22222222-2222-4222-8222-222222222222";
const base = "http://127.0.0.1:3023";
let printEnabled: boolean | undefined;
let productId: string, sideId: string;
const stamp = Date.now().toString().slice(-7);

async function login(page: Page) {
  await page.goto("/login?next=%2Fstaff%2Faming-chicken");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "店員", exact: true }).click();
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("staff-tools-toggle")).toBeEnabled();
}
async function search(page: Page, query: string) {
  await page.getByTestId("staff-search-open").click();
  const dialog = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
  await dialog.getByRole("searchbox").fill(query);
  await dialog.getByRole("button", { name: "確認", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL!);
  if (process.env.PLAYWRIGHT_APP_URL !== base || database.hostname !== "127.0.0.1" || database.port !== "55722" || database.pathname !== "/postgres") throw new Error("LOCAL_TARGET_REQUIRED");
  printEnabled = (await db.stallOrderingSettings.findUniqueOrThrow({ where: { stallId: stall } })).printModuleEnabled;
  await db.stallOrderingSettings.update({ where: { stallId: stall }, data: { printModuleEnabled: true } });
  const category = await db.productCategory.create({ data: { organizationId: org, name: `QA 改單 ${stamp}` } });
  async function product(name: string, price: number) {
    return (await db.product.create({ data: { organizationId: org, categoryId: category.id, name, description: "本機測試，請勿實際製作", defaultPrice: price,
      stallProducts: { create: { organizationId: org, stallId: stall, stockRemaining: 100 } },
    } })).id;
  }
  productId = await product(`QA 主餐 ${stamp}`, 80);
  sideId = await product(`QA 配菜 ${stamp}`, 30);
});
test.afterAll(async () => {
  if (printEnabled !== undefined) {
    await db.stallOrderingSettings.update({ where: { stallId: stall }, data: { printModuleEnabled: printEnabled } });
  }
  await db.$disconnect();
});

test("icon toolbar, search modal, responsive three panes and phone common controls", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await login(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const common = page.getByTestId("staff-common-controls");
    const sound = await common.getByRole("switch").boundingBox();
    const printer = await common.locator("[data-printer-status]").boundingBox();
    const sse = await common.getByRole("status").boundingBox();
    if (width < 768) {
      expect(sound!.x).toBeLessThan(printer!.x); expect(printer!.x).toBeLessThan(sse!.x);
      await expect(page.getByTestId("staff-push-controls")).toBeHidden();
    } else {
      await expect(page.getByTestId("staff-tools-toggle")).toBeHidden();
      await expect(page.getByTestId("staff-push-controls")).toBeVisible();
    }
    if (width >= 768) {
      await expect(page.getByTestId("staff-attendance")).toBeVisible();
      await expect(page.getByRole("heading", { name: "今日製作／逾期", exact: true })).toBeHidden();
      const board = await page.getByTestId("staff-order-master-detail").boundingBox();
      expect(board!.height).toBeGreaterThan(480);
      for (const pane of ["staff-order-list-pane", "staff-order-items-pane", "staff-order-actions-pane"]) {
        await expect(page.getByTestId(pane)).toBeVisible();
        expect(await page.getByTestId(pane).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      }
    } else {
      await expect(page.getByTestId("staff-attendance")).toBeHidden();
      await expect(page.getByTestId("staff-order-master-detail")).toBeHidden();
    }
    await page.screenshot({ path: test.info().outputPath(`staff-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("staff-tools-toggle").click();
  await expect(page.getByTestId("staff-attendance")).toBeVisible();
  await expect(page.getByTestId("staff-function-grid").locator("[data-extra-tool]")).toBeVisible();
  await page.getByTestId("staff-tools-toggle").click();
  await search(page, "NO_SUCH_ORDER_" + stamp);
  await expect(page.getByTestId("staff-queue-pagination")).toContainText("共 0 筆");
  await page.getByTestId("staff-search-open").click();
  const dialog = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
  await dialog.getByRole("button", { name: "清除搜尋", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("staff-search-open")).toBeFocused();
  await page.getByTestId("staff-tools-toggle").click();
  await page.getByTestId("staff-sticky-header").getByTestId("theme-toggle").click();
  await page.getByTestId("staff-tools-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("staff-common-controls").getByRole("switch").click();
  await expect(page.getByTestId("staff-common-controls").getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.interfaceMode = "senior"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("staff-senior-dark.png"), fullPage: true });
  expect(errors).toEqual([]);
});

for (const [source, fulfillmentType, future] of [["QR_MENU", "DELIVERY", false], ["QR_MENU", "DINE_IN", false], ["QR_MENU", "TAKEOUT", false], ["LINE_DELIVERY", "DELIVERY", false], ["QR_MENU", "DELIVERY", true]] as const) {
  test(`staff adjusts ${source} ${fulfillmentType}${future ? " future" : ""}, customer reads notice, stock/version/payment guards`, async ({ page, browser }) => {
    test.setTimeout(150_000);
    const token = "sto_" + randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""), device = randomUUID();
    const order = await db.order.create({ data: {
      organizationId: org, stallId: stall, orderNo: `QA-${stamp}-${source === "LINE_DELIVERY" ? "LINE" : fulfillmentType}${future ? "-FUTURE" : ""}`, idempotencyKey: randomUUID(),
      trackingTokenHash: createHash("sha256").update(token).digest("hex"), deviceHash: createHmac("sha256", process.env.ABUSE_HASH_SECRET!).update(`device:${device}`).digest("hex"),
      source, fulfillmentType: fulfillmentType as FulfillmentType, origin: "ONLINE_QR", isTest: true, customerName: `QA ${fulfillmentType} 改單`,
      customerPhone: "0912345678", deliveryAddress: fulfillmentType === "DELIVERY" ? "本機測試地址，請勿外送" : null,
      tableLabel: fulfillmentType === "DINE_IN" ? "QA A1" : null,
      scheduledPickupAt: future ? new Date(Date.now() + 2 * 86_400_000) : null,
      status: future ? "CONFIRMED" : "WAITING_CONFIRMATION", subtotal: 190, total: 190, confirmationExpiresAt: new Date(Date.now() + 86_400_000),
      items: { create: [
        { organizationId: org, stallId: stall, productId, sourceLineIndex: 1, name: `QA 主餐 ${stamp}`, quantity: 2, baseUnitPrice: 80, unitPrice: 80, status: "PENDING" },
        { organizationId: org, stallId: stall, productId: sideId, sourceLineIndex: 2, name: `QA 配菜 ${stamp}`, quantity: 1, baseUnitPrice: 30, unitPrice: 30, status: "PENDING" },
      ] },
    }, include: { items: true } });
    const stock = await db.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId: stall, productId: sideId } } });
    await page.setViewportSize({ width: 1024, height: 900 });
    await login(page); await search(page, order.orderNo);
    if (future) {
      await page.locator('[aria-controls="future-scheduled-orders"]').click();
      const futureCard = page.locator("#future-scheduled-orders article").filter({ hasText: order.orderNo });
      await expect(futureCard.getByRole("button", { name: "確認接單", exact: true })).toHaveCount(0);
      await futureCard.getByRole("button", { name: "修改訂單內容", exact: true }).click();
    } else await page.getByTestId("staff-order-actions-pane").getByRole("button", { name: "修改訂單內容", exact: true }).click();
    const editor = page.getByRole("dialog").filter({ has: page.locator("#order-edit-title") });
    await editor.getByRole("button", { name: `減少 QA 主餐 ${stamp} 數量`, exact: true }).click();
    await editor.locator(".divide-y > div").filter({ hasText: `QA 配菜 ${stamp}` }).getByRole("button", { name: "移除", exact: true }).click();
    const notice = `QA 缺貨調整：配菜售完不製作，主餐保留一份 ${stamp}`;
    await editor.getByRole("textbox").fill("");
    await expect(editor.getByRole("button", { name: "儲存並同步廚房", exact: true })).toBeDisabled();
    await editor.getByRole("textbox").fill(notice);
    const response = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/${order.id}/content`));
    await editor.getByRole("button", { name: "儲存並同步廚房", exact: true }).click();
    const saved = await response; expect(await saved.text()).not.toBe(""); expect(saved.status()).toBe(200);
    await expect(editor).not.toBeVisible();
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, events: true } });
    expect(current.total).toBe(80); expect(current.orderNo).toBe(order.orderNo); expect(current.items).toHaveLength(1);
    expect(current.events.some(event => event.eventType === "PUBLIC_ORDER_ITEMS_ADJUSTED" && JSON.stringify(event.metadataJson).includes(notice))).toBe(true);
    expect((await db.stallProduct.findUniqueOrThrow({ where: { id: stock.id } })).stockRemaining).toBe(stock.stockRemaining! + 1);
    const cookies = await page.context().cookies();
    const headers = { origin: base, "x-csrf-token": cookies.find(cookie => cookie.name === "stallorder_csrf")!.value };
    const replay = await page.request.patch(`/api/stalls/aming-chicken/orders/${order.id}/content`, { headers, data: saved.request().postDataJSON() });
    expect(replay.status()).toBe(200);
    expect(await db.orderEvent.count({ where: { orderId: order.id, eventType: "PUBLIC_ORDER_ITEMS_ADJUSTED" } })).toBe(1);
    expect((await db.stallProduct.findUniqueOrThrow({ where: { id: stock.id } })).stockRemaining).toBe(stock.stockRemaining! + 1);
    const command = { changeId: randomUUID(), expectedUpdatedAt: order.updatedAt.toISOString(), items: [{ kind: "EXISTING", itemId: current.items[0].id, quantity: 1 }], publicAmendment: { reason: "SOLD_OUT_REMOVE", customerMessage: notice } };
    const stale = await page.request.patch(`/api/stalls/aming-chicken/orders/${order.id}/content`, { headers, data: command });
    expect((await stale.json()).code).toBe("ORDER_CONFLICT");
    const customer = await browser.newContext({ baseURL: base });
    await customer.addCookies([{ name: "stallorder_device", value: device, url: base }]);
    const tracker = await customer.newPage();
    await tracker.goto(`/order/${token}`);
    await expect(tracker.getByText(notice, { exact: true })).toBeVisible({ timeout: 30_000 });
    await tracker.screenshot({ path: test.info().outputPath("customer-amendment.png"), fullPage: true });
    await customer.close();
    if (!future) {
      const confirmed = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith(`/orders/${order.id}`));
      await page.getByTestId("staff-order-actions-pane").getByRole("button", { name: "確認接單", exact: true }).click();
      expect((await confirmed).status()).toBe(200);
      const confirmedOrder = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { include: { productionTask: true } } } });
      expect(confirmedOrder.status).toBe("CONFIRMED");
      expect(confirmedOrder.items).toHaveLength(1);
      expect(confirmedOrder.items[0].productionTask?.status).toBe("PENDING");
    }
    // Paid / production transitions cannot be bypassed by replaying a fresh edit request.
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
    let locked = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    let rejected = await page.request.patch(`/api/stalls/aming-chicken/orders/${order.id}/content`, { headers, data: { ...command, changeId: randomUUID(), expectedUpdatedAt: locked.updatedAt.toISOString() } });
    expect((await rejected.json()).code).toBe("PAYMENT_ALREADY_RECORDED");
    await db.order.update({ where: { id: order.id }, data: { paymentStatus: "UNPAID" } });
    await db.orderItem.update({ where: { id: current.items[0].id }, data: { status: "PREPARING" } });
    locked = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    rejected = await page.request.patch(`/api/stalls/aming-chicken/orders/${order.id}/content`, { headers, data: { ...command, changeId: randomUUID(), expectedUpdatedAt: locked.updatedAt.toISOString() } });
    expect((await rejected.json()).code).toBe("ORDER_ALREADY_STARTED");
    await db.orderItem.update({ where: { id: current.items[0].id }, data: { status: "PENDING" } });
  });
}
