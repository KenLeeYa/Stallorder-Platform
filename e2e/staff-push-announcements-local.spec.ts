import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

test.describe.configure({ mode: "serial" });
test.use({ browserName: process.env.LOCAL_QA_BROWSER === "webkit" ? "webkit" : "chromium" });
test.skip(process.env.LOCAL_STAFF_PUSH_QA !== "true", "Requires explicit retained local QA fixture environment.");
const origin = "http://127.0.0.1:3018";
const org = "11111111-1111-4111-8111-111111111111";
const stall = "22222222-2222-4222-8222-222222222222";
const slug = "aming-chicken";
const announcementUrl = "/api/merchant/stalls/" + stall + "/menu-announcement";
const pushUrl = "/api/stalls/" + slug + "/push";
let db: PrismaClient, context: BrowserContext, page: Page;
let headers: Record<string, string>, productId: string, orderId: string, subscriptionId: string;
let revision: string | null = null;
const stamp = Date.now().toString().slice(-7);
const pageErrors: string[] = [];
const layouts: unknown[] = [];
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  if (process.env.PLAYWRIGHT_APP_URL !== origin || new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1"
    || new URL(process.env.DATABASE_URL!).port !== "55722") throw new Error("LOCAL_TARGET_MISMATCH");
  db = new PrismaClient();
  context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(30_000); page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/login");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "商家", exact: true }).click();
  await expect(page).toHaveURL(/merchant\/dashboard/);
  headers = { origin, "x-csrf-token": (await context.cookies()).find(cookie => cookie.name === "stallorder_csrf")!.value };
  const category = await db.productCategory.create({ data: { organizationId: org, name: "QA 版面與通知 " + stamp } });
  const product = await db.product.create({ data: { organizationId: org, categoryId: category.id,
    name: "QA 三欄完整顯示測試商品 " + stamp, description: "僅供本機版面與推播流程測試", defaultPrice: 100,
    stallProducts: { create: { organizationId: org, stallId: stall, isEnabled: true, stockRemaining: 100 } },
  } }); productId = product.id;
  revision = (await db.stallMenuAnnouncement.findUnique({ where: { stallId: stall } }))?.revision ?? null;
});
test.afterAll(async () => {
  // Keep examples without allowing mock subscriptions to send to external providers.
  if (subscriptionId) await db.staffPushSubscription.update({ where: { id: subscriptionId }, data: { enabled: false } });
  if (process.env.LOCAL_QA_EVIDENCE) writeFileSync(process.env.LOCAL_QA_EVIDENCE + "/browser-qa-" + (process.env.LOCAL_QA_BROWSER ?? "chromium") + "-" + stamp + ".json",
    JSON.stringify({ stamp, productId, orderId, subscriptionId, layouts, pageErrors, physicalPushDelivery: "AWAITING_USER_DEVICE" }, null, 2));
  await context?.close(); await db?.$disconnect();
});
async function saveAnnouncement(extra = {}, status = 200) {
  const response = await context.request.patch(announcementUrl, { headers, data: {
    enabled: true, title: "本機範例活動公告 " + stamp,
    content: "歡迎查看本機範例菜單。\n本公告僅供版面與流程測試，不代表正式優惠。",
    startsAt: null, endsAt: null, expectedRevision: revision, ...extra,
  } });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(status);
  if (body.announcement) revision = body.announcement.revision;
  return body;
}

test("推播訂閱權限、CSRF、限流與新單唯一入列；修改付款完成不新增通知", async () => {
  test.setTimeout(120_000);
  const anonymous = await context.browser()!.newContext({ baseURL: origin });
  expect((await anonymous.request.get(pushUrl)).status()).toBe(401);
  await anonymous.close();
  expect((await context.request.get("/api/cron/staff-push")).status()).toBe(401);
  expect((await context.request.post(pushUrl, { data: { operation: "UNSUBSCRIBE" } })).status()).toBe(403);
  const ec = createECDH("prime256v1"); ec.generateKeys();
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/local-qa-" + randomUUID(),
    keys: { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  expect((await context.request.post(pushUrl, { headers, data: { operation: "SUBSCRIBE", subscription: { ...subscription, endpoint: "https://127.0.0.1/private" } } })).status()).toBe(400);
  const enrolled = await context.request.post(pushUrl, { headers, data: { operation: "SUBSCRIBE", subscription } });
  const body = await enrolled.json(); expect(enrolled.status(), JSON.stringify(body)).toBe(200);
  subscriptionId = body.subscription.id;
  const stored = await db.staffPushSubscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  expect(stored.encryptedSubscription).not.toContain("googleapis");
  const key = randomUUID();
  const order = { idempotencyKey: key, customerName: "QA 長名稱不截斷左右滑動測試 " + stamp,
    customerNote: "同一個畫面應完整顯示三個區塊，欄內可上下捲動。", paymentTiming: "PAY_LATER",
    fulfillmentType: "TAKEOUT", items: [{ productId, quantity: 1 }] };
  const created = await context.request.post("/api/stalls/" + slug + "/orders", { headers, data: order });
  const result = await created.json(); expect(created.status(), JSON.stringify(result)).toBe(201); orderId = result.order.id;
  expect(await db.staffPushDelivery.count({ where: { orderId, subscriptionId } })).toBe(1);
  const replay = await context.request.post("/api/stalls/" + slug + "/orders", { headers, data: order });
  expect(replay.status()).toBe(200);
  await db.order.update({ where: { id: orderId }, data: { note: "改單範例", paymentStatus: "PAID", status: "COMPLETED" } });
  expect(await db.staffPushDelivery.count({ where: { orderId, subscriptionId } })).toBe(1);
  await db.order.update({ where: { id: orderId }, data: { status: "CONFIRMED", paymentStatus: "UNPAID" } });
  for (let i = 0; i < 3; i++) expect((await context.request.post(pushUrl, { headers, data: { operation: "TEST", subscriptionId } })).status()).toBe(202);
  expect((await context.request.post(pushUrl, { headers, data: { operation: "TEST", subscriptionId } })).status()).toBe(429);
  expect((await context.request.post("/api/push/receipt", { data: { id: randomUUID(), token: "x".repeat(43) } })).status()).toBe(403);
  await context.request.post(pushUrl, { headers, data: { operation: "UNSUBSCRIBE" } });
  expect((await db.staffPushSubscription.findUniqueOrThrow({ where: { id: subscriptionId } })).enabled).toBe(false);
});

test("三欄 768–1920px 與手機、長者模式完整顯示且各自上下捲動", async () => {
  test.setTimeout(180_000);
  await page.goto("/staff/" + slug);
  await page.getByTestId("staff-order-list-pane").waitFor();
  for (const mode of ["standard", "senior"]) {
    await page.evaluate(value => { document.documentElement.dataset.interfaceMode = value; }, mode);
    for (const width of [320, 390, 768, 820, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const measurement = await page.evaluate(() => {
        const ids = innerWidth >= 768 ? ["staff-order-list-pane", "staff-order-items-pane", "staff-order-actions-pane"] : ["staff-order-mobile-list"];
        return { width: innerWidth, mode: document.documentElement.dataset.interfaceMode,
          bodyWidth: document.documentElement.scrollWidth, panes: ids.map(id => {
            const el = document.querySelector<HTMLElement>('[data-testid="' + id + '"]')!;
            return { id, width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight,
              cardOverflow: Array.from(el.querySelectorAll("button")).some(c => c.scrollWidth > c.clientWidth + 1) };
          }) };
      });
      layouts.push(measurement);
      expect(measurement.bodyWidth, JSON.stringify(measurement)).toBeLessThanOrEqual(width + 1);
      for (const pane of measurement.panes) expect(pane.scroll, JSON.stringify(measurement)).toBeLessThanOrEqual(pane.width + 1);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/staff-three-pane-senior.png" });
  await page.getByRole("button", { name: "鎖屏通知", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "新訂單鎖屏通知" })).toBeVisible();
  const supportsPush = await page.evaluate(() => "PushManager" in window && "Notification" in window && isSecureContext);
  if (supportsPush) await expect(page.getByRole("button", { name: "開啟鎖屏通知", exact: true })).toBeEnabled();
  else {
    await expect(page.getByRole("button", { name: "開啟鎖屏通知", exact: true })).toBeDisabled();
    await expect(page.getByRole("dialog")).toContainText("尚不支援 Web Push");
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("公告開關、排程、過期、HTML 純文字及同一版本只提示一次", async () => {
  test.setTimeout(180_000);
  await saveAnnouncement({ title: "" }, 400);
  await saveAnnouncement({ startsAt: new Date(Date.now() + 60_000).toISOString(), endsAt: new Date().toISOString() }, 400);
  await saveAnnouncement({ startsAt: new Date(Date.now() + 86_400_000).toISOString() });
  await page.goto("/store/aming-01?view=menu");
  await expect(page.getByRole("button", { name: "查看店家公告" })).toHaveCount(0);
  await saveAnnouncement({ endsAt: new Date(Date.now() - 1000).toISOString() });
  await page.reload();
  await expect(page.getByRole("button", { name: "查看店家公告" })).toHaveCount(0);
  await saveAnnouncement({ content: "範例活動\n<script>alert('xss')</script>" });
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "本機範例活動公告 " + stamp });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("<script>alert('xss')</script>");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "查看店家公告" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "查看店家公告" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "我知道了" }).click();
  const staleRevision = revision;
  await saveAnnouncement();
  await saveAnnouncement({ expectedRevision: staleRevision }, 409);
  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "我知道了" }).click();
  await saveAnnouncement({ enabled: false });
  await page.reload();
  await expect(page.getByRole("button", { name: "查看店家公告" })).toHaveCount(0);
  await saveAnnouncement();
});

test("商家公告編輯預覽及手機平板視窗不超出畫面", async () => {
  test.setTimeout(120_000);
  await page.goto("/merchant/stalls/" + stall + "/settings/announcements");
  await page.getByTestId("menu-announcement-manager").waitFor();
  await expect(page.getByRole("button", { name: "預覽公告" })).toBeEnabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await page.getByRole("button", { name: "預覽公告" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await dialog.getByRole("button", { name: "我知道了" }).click();
  }
  await page.getByRole("button", { name: "儲存公告", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("公告已儲存");
  await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/merchant-announcement.png" });
  expect(pageErrors).toEqual([]);
});

test("店休優先、公告視窗焦點、暗色與資料庫讀取權限", async () => {
  test.setTimeout(120_000);
  await saveAnnouncement();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const closure = await db.stallSpecialClosure.create({ data: {
    organizationId: org, stallId: stall, startsOn: new Date(today), endsOn: new Date(today),
    title: "QA 店休優先提醒 " + stamp, message: "本機公告先後順序測試",
  } });
  try {
    await page.goto("/store/aming-01?view=menu");
    const closureDialog = page.getByTestId("special-closure-notice-dialog");
    await expect(closureDialog).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await closureDialog.getByRole("button", { name: "我知道了" }).click();
    const announcement = page.getByRole("dialog", { name: "本機範例活動公告 " + stamp });
    await expect(announcement).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.setViewportSize({ width: 820, height: 1100 });
    await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/menu-announcement-dark.png" });
    await announcement.getByRole("button", { name: "我知道了" }).focus();
    await page.keyboard.press("Tab");
    await expect(announcement.getByRole("button", { name: "關閉公告" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(announcement).toHaveCount(0);
  } finally {
    // Retain the fixture as a past closure so manual QA stays open.
    const past = new Date(Date.now() - 2 * 86_400_000);
    await db.stallSpecialClosure.update({ where: { id: closure.id }, data: { startsOn: past, endsOn: past } });
  }
  for (const table of ["staff_push_subscriptions", "staff_push_deliveries", "stall_menu_announcements"]) {
    await expect(db.$transaction(async tx => {
      await tx.$executeRawUnsafe("set local role authenticated");
      await tx.$queryRawUnsafe("select * from public." + table);
    })).rejects.toThrow(/permission denied/);
  }
  const kitchen = await context.browser()!.newContext({ baseURL: origin });
  const kp = await kitchen.newPage();
  await kp.goto("/login");
  await kp.getByTestId("local-qa-login-grid").getByRole("button", { name: "廚房", exact: true }).click();
  await expect(kp).toHaveURL(/\/kitchen/);
  expect((await kitchen.request.get(pushUrl)).status()).toBe(403);
  const kitchenHeaders = { origin, "x-csrf-token": (await kitchen.cookies()).find(cookie => cookie.name === "stallorder_csrf")!.value };
  expect((await kitchen.request.patch(announcementUrl, { headers: kitchenHeaders, data: {} })).status()).toBe(403);
  await kitchen.close();
});
