import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { dismissStaffStartReminder, establishLocalTestSession } from "./local-navigation";

test.use({ ignoreHTTPSErrors: true, trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
const origin = process.env.PLAYWRIGHT_APP_URL;
const enabled = process.env.LINE_PLATFORM_UI_TEST === "true";
test.skip(!enabled, "Explicit isolated platform UI QA only.");
const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid");
if (enabled && (origin !== "https://127.0.0.1:3024" || !["127.0.0.1", "localhost"].includes(database.hostname)
  || database.port !== "55722" || database.pathname !== "/stallorder_line_miniapp_20260926")) throw new Error("LINE_PLATFORM_UI_TEST_TARGET_REJECTED");
const db = new PrismaClient();
const org = "11111111-1111-4111-8111-111111111111";
const stalls = [randomUUID(), randomUUID()];
const names = ["合成測試一店 🌿 蔬食餐盒與手作飲品的很長店名", "合成測試二店 🍜 夜間食堂"];
const profiles: Array<{ id: string; identityId: string; hash: string; ciphertext: string }> = [];
const orders: string[] = [];
const trackingTokens = new Map<string, string>();
let foreignOrder = "";
let staffId = "";
let managerId = "";
let adminId = "";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 47), iv);
  cipher.setAAD(Buffer.from("platform-value-v1"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
function observe(page: Page) {
  const errors: string[] = [];
  const redact = (s: string) => s.replace(/qpm1_[A-Za-z0-9_-]+|qidaigo:pickup:v1:[A-Za-z0-9_-]+/g, "[REDACTED]");
  page.on("pageerror", (error) => errors.push(redact(error.message)));
  page.on("console", (entry) => { if (entry.type() === "error") {
    const source = entry.location().url;
    const location = source ? new URL(source) : null;
    errors.push(redact(`${entry.text()}${location ? ` ${location.origin}${location.pathname}` : ""}`));
  } });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === origin) {
      const path = new URL(response.url()).pathname.replace(/\/media\/.*/, "/media/[REDACTED]");
      errors.push(`HTTP ${response.status()} ${path}`);
    }
  });
  return errors;
}
async function createOrder(stallId: string, profileIndex = 0, cancelled = false) {
  const id = randomUUID();
  const trackingToken = `sto_${randomBytes(32).toString("base64url")}`;
  trackingTokens.set(id, trackingToken);
  await db.order.create({ data: { id, organizationId: org, stallId, orderNo: `UI-${id.slice(0, 12)}`,
    source: "QR_MENU", origin: "TEST", isTest: true, customerName: "合成顧客", fulfillmentType: "TAKEOUT",
    status: cancelled ? "CANCELLED" : "READY", paymentStatus: "PAID", subtotal: 180, total: 180,
    deviceHash: digest(randomUUID()), trackingTokenHash: digest(trackingToken), idempotencyKey: randomUUID(),
    pickupCodeDisplay: "627", pickupCodeHash: digest("627"), pickupCodeLength: 3,
    confirmationExpiresAt: new Date(Date.now() + 60 * 60_000),
    items: { create: { organizationId: org, stallId, name: "合成超長餐點名稱 🌿 手作鮮蔬便當（不辣）", quantity: 1,
      baseUnitPrice: 180, unitPrice: 180, status: "READY" } } } });
  const owner = profiles[profileIndex];
  await db.$executeRaw`insert into public.line_platform_order_owners(order_id,profile_id,environment,provider_id,subject_hash,pickup_required)
    values(${id}::uuid,${owner.id}::uuid,'local','1234567',${owner.hash},true)`;
  return id;
}

test.beforeAll(async () => {
  for (const [index, stallId] of stalls.entries()) {
    await db.stall.create({ data: { id: stallId, organizationId: org, name: names[index], code: `UI-${stallId}`,
      slug: `platform-ui-${stallId}`, address: "合成地址", location: "合成取餐地點：櫃台右側" } });
    await db.stallOrderingSettings.create({ data: { organizationId: org, stallId } });
    await db.attendancePolicy.upsert({ where: { stallId }, create: { organizationId: org, stallId,
      enabled: true, latitude: 25.033, longitude: 121.565 }, update: { enabled: true, latitude: 25.033, longitude: 121.565 } });
    await db.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at)
      values(${stallId}::uuid,'local',true,now()-interval '1 hour')`;
  }
  for (let index = 0; index < 2; index++) {
    const profile = await db.profile.create({ data: { displayName: `合成平台顧客 ${index}` } });
    const subject = `U${randomUUID().replaceAll("-", "")}`;
    const subjectHash = digest(JSON.stringify(["local", "1234567", subject])); const ciphertext = encrypt(subject);
    const identity = await db.authIdentity.create({ data: { profileId: profile.id, provider: "LINE",
      providerSubject: `miniapp:local:1234567:${subjectHash}`, providerMetadata: { subjectCiphertext: ciphertext } } });
    profiles.push({ id: profile.id, identityId: identity.id, hash: subjectHash, ciphertext });
  }
  const other = profiles[1];
  await db.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,
    subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source)
    values(${other.id}::uuid,${other.identityId}::uuid,'local','1234567',${other.hash},${other.ciphertext},'test-v1',now(),'MINI_APP')`;
  staffId = (await db.profile.create({ data: { displayName: "合成一般店員" } })).id;
  managerId = (await db.profile.create({ data: { displayName: "合成門市經理" } })).id;
  adminId = (await db.profile.create({ data: { displayName: "合成平台管理員", platformRole: "PLATFORM_ADMIN" } })).id;
  await db.stallMembership.createMany({ data: [
    { organizationId: org, stallId: stalls[0], profileId: staffId, role: "STAFF" },
    { organizationId: org, stallId: stalls[0], profileId: managerId, role: "STALL_MANAGER" },
  ] });
});
test.afterAll(async () => { await db.$disconnect(); });

test.beforeEach(async ({ page }) => {
  // Synthetic sessions have no real LIFF channel. Model an invalid provider
  // context without contacting LINE or granting a fake friendship.
  await page.route("https://api.line.me/liff/v2/apps/1234568-fixture/contextToken", route => route.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}",
  }));
});

test("member explicitly accepts terms and can persist transaction-notification preferences", async ({ page }) => {
  const errors = observe(page);
  const memberRequests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (["/mini/member", "/api/mini/member", "/api/auth/me"].includes(path)) memberRequests.push(`${request.method()} ${path}`);
  });
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (["/mini/member", "/api/mini/member", "/api/auth/me"].includes(path)) memberRequests.push(`${response.status()} ${response.request().method()} ${path}`);
  });
  await establishLocalTestSession(page, db, profiles[0].id);
  await page.goto("/mini");
  await page.getByRole("navigation", { name: "攤點通會員導覽" }).getByRole("link", { name: "會員", exact: true }).click();
  await expect(page.getByRole("heading", { name: "平台會員中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "加入平台會員" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /我已閱讀並同意/ }).check();
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.getByRole("button", { name: "加入平台會員" }).click()]);
  await expect(page.getByRole("button", { name: "儲存通知設定" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /接收攤點通官方帳號/ })).not.toBeChecked();
  await page.getByRole("checkbox", { name: /接收攤點通官方帳號/ }).check();
  const [saved] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/mini/member" && response.request().method() === "PATCH", { timeout: 15_000 }),
    page.waitForNavigation({ waitUntil: "load", timeout: 15_000 }),
    page.getByRole("button", { name: "儲存通知設定" }).click(),
  ]).catch(() => { throw new Error(`MEMBER_SAVE_NOT_COMPLETED ${JSON.stringify({ path: new URL(page.url()).pathname, memberRequests, errors })}`); });
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toEqual({ notificationConsent: true });
  await expect(page.getByRole("checkbox", { name: /接收攤點通官方帳號/ })).toBeChecked();
  await expect.poll(async () => (await db.$queryRaw<Array<{ consent: boolean }>>`
    select notification_consent as consent from public.line_platform_members where profile_id=${profiles[0].id}::uuid`)[0]?.consent).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /接收攤點通官方帳號/ })).toBeChecked();
  expect(await db.stallMembership.count({ where: { profileId: profiles[0].id } })).toBe(0);
  expect(errors).toEqual([]);
  for (const stall of stalls) orders.push(await createOrder(stall));
  orders.push(await createOrder(stalls[0], 0, true)); foreignOrder = await createOrder(stalls[0], 1);
});

test("unavailable LIFF friendship stays unknown, preserves consent and offers a working retry", async ({ page }) => {
  const errors = observe(page);
  await establishLocalTestSession(page, db, profiles[0].id);
  await page.goto("/mini/member");
  await expect(page.getByRole("status")).toHaveText("尚未確認好友狀態");
  await expect(page.getByRole("alert").filter({ hasText: "好友狀態尚未同步" })).toBeVisible();
  await page.getByRole("button", { name: "重新確認好友狀態" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "暫時無法確認好友" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新確認好友狀態" })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: /接收攤點通官方帳號/ })).toBeChecked();
  expect(await db.$queryRaw`select status from public.line_platform_friendships where subject_hash=${profiles[0].hash}`).toEqual([]);
  expect(errors).toEqual([]);
});

test("owner sees both stores, filters history, opens a private QR, and another member receives 404", async ({ page, browser }) => {
  const errors = observe(page);
  await establishLocalTestSession(page, db, profiles[0].id);
  const response = await page.goto("/mini/orders");
  // Next dev forces its HTML revalidation header; production no-store needs deployed readback.
  expect(response?.headers()["cache-control"]).not.toMatch(/public|s-maxage/i);
  for (const id of orders.slice(0, 2)) await expect(page.locator(`a[href="/mini/orders/${id}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/mini/orders/${foreignOrder}"]`)).toHaveCount(0);
  await page.locator('select[name="stall"]').selectOption(stalls[1]);
  await page.getByRole("button", { name: "查詢", exact: true }).click();
  await expect(page.locator(`a[href="/mini/orders/${orders[1]}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/mini/orders/${orders[0]}"]`)).toHaveCount(0);
  await page.locator('select[name="stall"]').selectOption("");
  await page.locator('select[name="view"]').selectOption("history");
  await page.getByRole("button", { name: "查詢", exact: true }).click();
  await expect(page.locator(`a[href="/mini/orders/${orders[2]}"]`)).toBeVisible();
  // Original checkout/recovery URLs must return an authenticated owner to the
  // private MINI details even without the old guest-device tracking cookie.
  await page.goto(`/order/${trackingTokens.get(orders[0])}`);
  await expect(page).toHaveURL(`${origin}/mini/orders/${orders[0]}`);
  await expect(page.getByText("餐點已完成", { exact: true })).toBeVisible();
  const privateJson = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/line-platform/pickup/customer/${orders[0]}`);
  const privateImage = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/api/line-platform/media/"));
  await page.getByRole("button", { name: "顯示／更新取餐 QR" }).click();
  expect((await privateJson).headers()["cache-control"]).toContain("no-store");
  const imageResponse = await privateImage;
  expect(imageResponse.headers()["cache-control"]).toContain("no-store");
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toContain("image/png");
  expect((await imageResponse.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const qr = page.getByRole("img", { name: /由店員核對交付的取餐 QR/ });
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(512);
  expect((await db.order.findUniqueOrThrow({ where: { id: orders[0] } })).status).toBe("READY");
  expect(await db.orderEvent.count({ where: { orderId: orders[0], eventType: "LINE_PLATFORM_PICKED_UP" } })).toBe(0);
  expect(errors).toEqual([]);
  const other = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
  try {
    const stranger = await other.newPage(); await establishLocalTestSession(stranger, db, profiles[1].id);
    const denied = await stranger.goto(`/mini/orders/${orders[0]}`);
    expect(denied?.status()).toBe(404);
    await expect(stranger.getByRole("button", { name: "顯示／更新取餐 QR" })).toHaveCount(0);
  } finally { await other.close(); }
});

test("MINI pages fit 320/390/768/1440 light and dark with doubled text", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = observe(page); const overflow: string[] = [];
  await establishLocalTestSession(page, db, profiles[0].id);
  const paths = ["/mini", "/mini/member", "/mini/orders", `/mini/orders/${orders[0]}`, "/mini/help"];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const presentation of [{ colorScheme: "light" as const, fontSize: "100%" }, { colorScheme: "dark" as const, fontSize: "200%" }]) {
      await page.emulateMedia({ colorScheme: presentation.colorScheme });
      for (const path of paths) {
        await page.goto(path); await expect(page.locator("main h1")).toBeVisible();
        await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, presentation.fontSize);
        await page.evaluate(() => document.fonts.ready);
        const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
        if (size.scroll > size.viewport + 1) overflow.push(`${path.includes("/orders/") ? "/mini/orders/[id]" : path} ${width} ${presentation.colorScheme} ${presentation.fontSize}: ${size.scroll}/${size.viewport}`);
      }
    }
  }
  expect(overflow).toEqual([]); expect(errors).toEqual([]);
});

test("admin and authorized merchant read notification dashboards while ordinary staff is denied", async ({ page }) => {
  const errors = observe(page);
  await establishLocalTestSession(page, db, adminId);
  const adminData = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/admin/line-platform/notifications");
  const rolloutData = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/admin/line-platform/stalls");
  expect((await page.goto("/admin/line-platform"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "平台 LINE 通知", exact: true })).toBeVisible();
  expect((await adminData).status()).toBe(200);
  expect((await rolloutData).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "平台帳號與共用配額" })).toBeVisible();
  await expect(page.getByText("通知功能已暫停", { exact: true })).toBeVisible();
  // Read-only QA: never click registry sync, rollout toggles, or provider retry.
  await establishLocalTestSession(page, db, managerId);
  const merchantData = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/merchant/stalls/${stalls[0]}/notifications`);
  expect((await page.goto(`/merchant/platform-ui-${stalls[0]}/notifications`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: `${names[0]}・訂單通知`, exact: true })).toBeVisible();
  expect((await merchantData).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "最近 100 筆通知" })).toBeVisible();
  await expect(page.getByRole("button", { name: "同步平台帳號設定" })).toHaveCount(0);
  expect((await page.request.get(`/api/merchant/stalls/${stalls[1]}/notifications`)).status()).toBe(404);
  expect(errors).toEqual([]);
  await establishLocalTestSession(page, db, staffId);
  expect((await page.request.get(`/api/merchant/stalls/${stalls[0]}/notifications`)).status()).toBe(403);
  expect((await page.request.get("/api/admin/line-platform/notifications")).status()).toBe(404);
  expect((await page.goto(`/merchant/platform-ui-${stalls[0]}/notifications`))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: `${names[0]}・訂單通知`, exact: true })).toHaveCount(0);
});

test("generic staff member page offers LINE identity login instead of an unusable terms form", async ({ page }) => {
  const errors = observe(page);
  await establishLocalTestSession(page, db, staffId);
  expect((await page.goto("/mini/member"))?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "使用 LINE 顧客身分登入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "加入平台會員" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /我已閱讀並同意/ })).toHaveCount(0);
  expect(await db.authIdentity.count({ where: { profileId: staffId, provider: "LINE" } })).toBe(0);
  expect(errors).toEqual([]);
});

test("staff issues a first credential after pilot shutdown, previews and explicitly hands over the original order", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = observe(page);
  const handoffOrder = await createOrder(stalls[0], 1);
  expect(await db.$queryRaw`select id from public.line_platform_pickup_credentials where order_id=${handoffOrder}::uuid`).toEqual([]);
  await db.$executeRaw`update public.line_platform_stalls set enabled=false where stall_id=${stalls[0]}::uuid`;
  await establishLocalTestSession(page, db, staffId);
  const base = `/api/line-platform/pickup/platform-ui-${stalls[0]}`;

  expect((await page.goto(`/staff/platform-ui-${stalls[0]}`))?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "平台 QR 掃碼交付" })).toBeVisible({ timeout: 30_000 });
  await dismissStaffStartReminder(page);
  const panel = page.getByRole("region", { name: "平台 QR 交付" });
  await panel.getByRole("button", { name: "平台 QR 掃碼交付" }).click();
  await panel.getByRole("button", { name: "人工核對／憑證管理" }).click();
  await panel.getByLabel("本店訂單").selectOption(handoffOrder);
  await panel.getByLabel("顧客短取餐碼").fill("627");
  await panel.getByLabel("人工核對原因").selectOption("CAMERA_UNAVAILABLE");
  await panel.locator("summary").click();
  await panel.getByRole("button", { name: "查詢所選訂單憑證" }).click();
  await expect(panel.getByText("版本 0 · 尚未發行", { exact: true })).toBeVisible();
  await panel.getByLabel("處理原因（至少五個字）").fill("試營運停止後核對既有訂單交付");
  const issued = page.waitForResponse((r) => new URL(r.url()).pathname === `${base}/manage` && r.request().method() === "POST");
  await panel.getByRole("button", { name: "發行取餐憑證", exact: true }).click();
  expect((await issued).status()).toBe(200);
  await expect(panel.getByRole("status")).toHaveText("已發行取餐憑證，請重新預覽餐點並核對交付。");
  await expect(panel.getByRole("button", { name: "預覽餐點與付款" })).toBeDisabled();
  await panel.getByRole("checkbox", { name: "已核對顧客、餐點及取餐號" }).check();
  const preview = page.waitForResponse((r) => new URL(r.url()).pathname === `${base}/preview` && r.request().method() === "POST");
  await panel.getByRole("button", { name: "預覽餐點與付款" }).click();
  expect((await preview).status()).toBe(200);
  await expect(panel.getByTestId("platform-pickup-preview")).toContainText("已付款");
  await expect(panel.getByTestId("platform-pickup-preview")).toContainText("餐點已完成");
  await expect(panel.getByRole("button", { name: "確認交付／完成取餐" })).toBeDisabled();
  expect((await db.order.findUniqueOrThrow({ where: { id: handoffOrder } })).status).toBe("READY");
  expect(await db.orderEvent.count({ where: { orderId: handoffOrder, eventType: "LINE_PLATFORM_PICKED_UP" } })).toBe(0);
  await panel.getByRole("checkbox", { name: "已核對並實際交付全部餐點" }).check();
  const redemption = page.waitForResponse((r) => new URL(r.url()).pathname === `${base}/redeem` && r.request().method() === "POST");
  await panel.getByRole("button", { name: "確認交付／完成取餐" }).click();
  const redeemed = await redemption;
  expect(redeemed.status()).toBe(200);
  expect(redeemed.request().postDataJSON()).toMatchObject({ confirmedHandoff: true,
    credential: { kind: "MANUAL", orderId: handoffOrder, reason: "CAMERA_UNAVAILABLE", confirmedCustomerDetails: true } });
  await expect(panel.getByRole("status")).toHaveText("已確認交付。通知將由平台另外處理。");
  await expect(panel.getByRole("button", { name: "確認交付／完成取餐" })).toHaveCount(0);
  const original = await db.order.findUniqueOrThrow({ where: { id: handoffOrder } });
  expect(original.status).toBe("COMPLETED"); expect(original.completedAt).not.toBeNull();
  expect(await db.orderEvent.count({ where: { orderId: handoffOrder, eventType: "LINE_PLATFORM_PICKED_UP" } })).toBe(1);
  const credential = await db.$queryRaw<Array<{ redeemed_by: string | null; redemption_method: string | null }>>`
    select redeemed_by::text, redemption_method from public.line_platform_pickup_credentials where order_id=${handoffOrder}::uuid`;
  expect(credential).toEqual([{ redeemed_by: staffId, redemption_method: "MANUAL" }]);
  expect(errors).toEqual([]);
  await db.$executeRaw`update public.line_platform_stalls set enabled=true where stall_id=${stalls[0]}::uuid`;
});

test("member logout returns to MINI and removes access to the prior private orders", async ({ page }) => {
  const errors = observe(page);
  const order = await createOrder(stalls[1], 1);
  await establishLocalTestSession(page, db, profiles[1].id);
  await page.goto("/mini/orders");
  await expect(page.locator(`a[href="/mini/orders/${order}"]`)).toBeVisible();
  await page.getByRole("navigation", { name: "攤點通會員導覽" }).getByRole("link", { name: "會員", exact: true }).click();
  const logout = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/logout" && r.request().method() === "POST");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  expect((await logout).status()).toBe(200);
  await expect(page).toHaveURL(`${origin}/mini`);
  await page.getByRole("navigation", { name: "攤點通會員導覽" }).getByRole("link", { name: "我的訂單", exact: true }).click();
  await expect(page.getByRole("button", { name: "使用 LINE 顧客身分登入" })).toBeVisible();
  await expect(page.locator(`a[href="/mini/orders/${order}"]`)).toHaveCount(0);
  expect(errors).toEqual([]);
  // Anonymous detail visits intentionally show a login prompt; another signed-in owner gets 404.
  expect((await page.goto(`/mini/orders/${order}`))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "查看本人訂單" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用 LINE 顧客身分登入" })).toBeVisible();
  await expect(page.getByText(`訂單 UI-${order.slice(0, 12)}`, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "顯示／更新取餐 QR" })).toHaveCount(0);
});

test("guest explicitly transfers a fresh cart and the same browser member imports it into the original checkout", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = observe(page);
  const stallId = stalls[1], code = `ui-${stallId}`, productName = "合成訪客交接餐";
  await db.stallOrderingSettings.update({ where: { stallId }, data: { takeoutPreorderEnabled: true } });
  await db.stallBusinessHour.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: org,
    stallId, dayOfWeek, opensAt: "00:00", closesAt: "00:00" })) });
  const category = await db.productCategory.create({ data: { organizationId: org, name: `合成交接 ${stallId}` } });
  const product = await db.product.create({ data: { organizationId: org, categoryId: category.id, name: productName,
    description: "Synthetic browser handoff fixture", defaultPrice: 73,
    stallProducts: { create: { organizationId: org, stallId, stockRemaining: 20 } } } });
  const memberProduct = await db.product.create({ data: { organizationId: org, categoryId: category.id, name: "合成會員原草稿餐",
    description: "Synthetic existing member cart", defaultPrice: 89,
    stallProducts: { create: { organizationId: org, stallId, stockRemaining: 20 } } } });
  const qr = await db.qrCode.create({ data: { organizationId: org, stallId, token: `cart-ui-${randomUUID()}`,
    label: "Synthetic guest handoff", fulfillmentTypeContext: "TAKEOUT" } });
  const flag = await db.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "DUAL_ORDER_INTAKE_ENABLED" } });
  const override = await db.resilienceFeatureFlagOverride.create({ data: { flagId: flag.id, scopeType: "STALL",
    organizationId: org, stallId, enabled: true, reason: "Synthetic A06 browser original checkout only",
    expiresAt: new Date(Date.now() + 10 * 60_000) } });
  try {
    await page.setExtraHTTPHeaders({ "x-real-ip": "198.18.27.61", "cf-connecting-ip": "198.18.27.61" });
    const [sessionResponse, storefront] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/public/order-session" && r.request().method() === "POST", { timeout: 60_000 }),
      page.goto(`/store/${code}?view=pickup`),
    ]).catch(() => { throw new Error(`GUEST_SESSION_NOT_READY ${JSON.stringify({ path: new URL(page.url()).pathname, errors })}`); });
    expect(storefront?.status()).toBe(200);
    expect(sessionResponse.status()).toBe(201);
    const guestSessionHash = digest((await sessionResponse.json()).orderSessionToken as string);
    await page.getByRole("button", { name: "套用這個時間", exact: true }).click();
    await page.locator(`article#qr-product-${product.id}`).getByRole("button", { name: `增加 ${productName}`, exact: true }).click();
    const exported = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/public/cart-handoff" && r.request().method() === "POST");
    await page.getByRole("button", { name: "用 LINE 繼續此購物車", exact: true }).click();
    expect((await exported).status()).toBe(200);
    await expect(page).toHaveURL(`${origin}/mini/store/${code}?view=pickup`);
    await expect(page.getByRole("button", { name: "使用 LINE 顧客身分登入" })).toBeVisible();
    // Real LINE authentication remains a separate provider gate. Reuse only this browser's proof and sealed draft.
    await establishLocalTestSession(page, db, profiles[1].id);
    await page.reload();
    const importButton = page.getByRole("button", { name: "匯入剛才的訪客購物車", exact: true });
    await expect(importButton).toBeEnabled();
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(0);
    await page.getByRole("button", { name: "套用這個時間", exact: true }).click();
    await page.locator(`article#qr-product-${memberProduct.id}`).getByRole("button", { name: "增加 合成會員原草稿餐", exact: true }).click();
    await expect(page.getByTestId("qr-cart-line")).toContainText("合成會員原草稿餐");
    await expect(page.getByTestId("qr-cart-line")).not.toContainText(productName);
    const imported = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/mini/cart-handoff" && r.request().method() === "POST");
    await importButton.click();
    expect((await imported).status()).toBe(200);
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(1);
    await expect(page.getByTestId("qr-cart-line")).toContainText(productName);
    await expect(page.getByTestId("qr-cart-line")).not.toContainText("合成會員原草稿餐");
    await expect(importButton).toHaveCount(0);
    const claim = await db.$queryRaw<Array<{ owner: string; mode: string; status: string }>>`
      select line_platform_cart_claim_profile_id::text as owner,ordering_mode as mode,status::text
      from public.order_sessions where token_hash=${guestSessionHash} and qr_code_id=${qr.id}::uuid`;
    expect(claim).toEqual([{ owner: profiles[1].id, mode: "PREORDER", status: "ACTIVE" }]);
    expect(await db.order.count({ where: { stallId, items: { some: { productId: product.id } } } })).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await db.resilienceFeatureFlagOverride.delete({ where: { id: override.id } });
  }
});

test("public pickup and delivery entries keep anonymous carts and route valid members into isolated MINI carts", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = observe(page);
  const stallId = randomUUID(), code = `entry-${stallId}`;
  await db.stall.create({ data: { id: stallId, organizationId: org, code, slug: `entry-private-${stallId}`,
    name: "合成會員入口店", address: "合成地址", location: "合成入口測試" } });
  await db.stallOrderingSettings.create({ data: { organizationId: org, stallId,
    takeoutPreorderEnabled: true, deliveryModuleEnabled: true } });
  await db.stallBusinessHour.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ organizationId: org,
    stallId, dayOfWeek, opensAt: "00:00", closesAt: "00:00" })) });
  await db.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at)
    values(${stallId}::uuid,'local',true,now()-interval '1 hour')`;
  const category = await db.productCategory.create({ data: { organizationId: org, name: `合成入口 ${stallId}` } });
  const products = await Promise.all(["匿名入口原草稿餐", "會員隔離新草稿餐"].map(name => db.product.create({ data: {
    organizationId: org, categoryId: category.id, name, description: "Synthetic member entry fixture", defaultPrice: 67,
    stallProducts: { create: { organizationId: org, stallId, stockRemaining: 20 } },
  } })));
  await db.qrCode.create({ data: { organizationId: org, stallId, token: `entry-ui-${randomUUID()}`,
    label: "Synthetic pickup and delivery entry" } });
  await page.setExtraHTTPHeaders({ "x-real-ip": "198.18.27.62", "cf-connecting-ip": "198.18.27.62" });

  for (const view of ["pickup", "delivery"] as const) {
    const mode = view === "pickup" ? "PREORDER" : "DELIVERY";
    const publicPath = `/store/${code}?view=${view}&locale=zh-TW`;
    const openSession = async () => {
      const [response, document] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === "/api/public/order-session" && r.request().method() === "POST", { timeout: 60_000 }),
        page.goto(publicPath),
      ]);
      expect(document?.status()).toBe(200);
      expect(response.status()).toBe(201);
      const session = await response.json() as { orderingMode: string; orderSessionToken: string };
      expect(session.orderingMode).toBe(mode);
      return digest(session.orderSessionToken);
    };
    const guestHash = await openSession();
    await expect(page).toHaveURL(`${origin}${publicPath}`);
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(0);
    if (view === "pickup") await page.getByRole("button", { name: "套用這個時間", exact: true }).click();
    await page.locator(`article#qr-product-${products[0].id}`).getByRole("button", { name: "增加 匿名入口原草稿餐", exact: true }).click();
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(1);
    await expect(page.getByTestId("qr-cart-line")).toContainText("匿名入口原草稿餐");
    await expect(page.getByRole("button", { name: "用 LINE 繼續此購物車", exact: true })).toBeVisible();

    await establishLocalTestSession(page, db, profiles[1].id);
    const memberHash = await openSession();
    await expect(page).toHaveURL(`${origin}/mini/store/${code}?locale=zh-TW&view=${view}`);
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "匯入剛才的訪客購物車", exact: true })).toHaveCount(0);
    if (view === "pickup") await page.getByRole("button", { name: "套用這個時間", exact: true }).click();
    await page.locator(`article#qr-product-${products[1].id}`).getByRole("button", { name: "增加 會員隔離新草稿餐", exact: true }).click();
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(1);
    await expect(page.getByTestId("qr-cart-line")).toContainText("會員隔離新草稿餐");
    await expect(page.getByTestId("qr-cart-line")).not.toContainText("匿名入口原草稿餐");
    const claims = await db.$queryRaw<Array<{ token_hash: string; owner: string | null }>>`
      select token_hash,line_platform_cart_claim_profile_id::text as owner from public.order_sessions
      where stall_id=${stallId}::uuid and token_hash in (${guestHash},${memberHash}) order by token_hash`;
    expect(claims).toEqual([{ token_hash: guestHash, owner: null }, { token_hash: memberHash, owner: profiles[1].id }]
      .sort((left, right) => left.token_hash.localeCompare(right.token_hash)));

    await page.goto("/mini/member");
    await page.getByRole("button", { name: "登出", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/mini`);
    await openSession();
    await expect(page).toHaveURL(`${origin}${publicPath}`);
    await expect(page.getByTestId("qr-cart-line")).toHaveCount(1);
    await expect(page.getByTestId("qr-cart-line")).toContainText("匿名入口原草稿餐");
    await expect(page.getByTestId("qr-cart-line")).not.toContainText("會員隔離新草稿餐");
  }
  expect(await db.order.count({ where: { stallId } })).toBe(0);
  expect(errors).toEqual([]);
});
