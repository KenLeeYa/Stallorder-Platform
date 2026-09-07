import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { dateInTimeZone } from "../src/lib/special-closures-client";
import { dismissStaffStartReminder, gotoLocalPath, loginLocalTestAccount } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const qrToken = "experience-" + randomUUID();
const orderIds: string[] = [];
let qrId = "";
let productId = "";
let closureId = "";
let originalHours: Array<{ id: string; opensAt: string; closesAt: string; isClosed: boolean }> = [];
test.use({ serviceWorkers: "block" });
test.beforeAll(async () => {
  if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname)) throw new Error("LOCAL_EXPERIENCE_TEST_ONLY");
  originalHours = await prisma.stallBusinessHour.findMany({ where: { stallId }, select: { id: true, opensAt: true, closesAt: true, isClosed: true } });
  await prisma.stallBusinessHour.updateMany({ where: { stallId }, data: { opensAt: "00:00", closesAt: "23:59", isClosed: false } });
  const version = await prisma.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } });
  qrId = (await prisma.qrCode.create({ data: { organizationId, stallId, token: qrToken, label: "Local order experience", state: "ACTIVE", tokenVersion: (version._max.tokenVersion ?? 0) + 1 } })).id;
  const category = await prisma.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true }, select: { id: true } });
  productId = (await prisma.product.create({ data: {
    organizationId, categoryId: category.id, name: "體驗測試餐", kind: "SINGLE", description: "local fixture", defaultPrice: 50, isActive: true,
    stallProducts: { create: { organizationId, stallId, isEnabled: true, isSoldOut: false } },
  } })).id;
});
test.afterAll(async () => {
  try {
    if (closureId) await prisma.stallSpecialClosure.deleteMany({ where: { id: closureId } });
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
    for (const { id, ...data } of originalHours) await prisma.stallBusinessHour.update({ where: { id }, data });
  } finally { await prisma.$disconnect(); }
});

async function createOrder(page: Page, preorder = false) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const deviceId = randomUUID();
  const headers = { origin, "x-stallorder-protocol-version": "1", "x-stallorder-operation-id": randomUUID() };
  const orderingMode = preorder ? "PREORDER" : "DEFAULT";
  const sessionResponse = await page.request.post("/api/public/order-session", { headers, data: { qrToken, deviceId, orderingMode, sessionRequestId: randomUUID() } });
  expect(sessionResponse.status()).toBe(201);
  const session = await sessionResponse.json();
  const id = randomUUID();
  orderIds.push(id);
  const response = await page.request.post("/api/public/orders", { headers, data: {
    qrToken, deviceId, orderingMode, orderSessionToken: session.orderSessionToken,
    clientOrderId: id, idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    customerName: "本機體驗測試", customerPhone: "0912345678", customerNote: "【免洗餐具：需要】\n少鹽",
    scheduledPickupAt: preorder ? session.preorderSlots[4] : null, waitAcknowledged: true, items: [{ productId, quantity: 1 }],
  } });
  expect(response.status(), response.ok() ? undefined : (await response.json()).code).toBe(201);
  return { id, ...(await response.json()) as { trackingToken: string }, deviceId, origin, pickupAt: session.preorderSlots[4] as string };
}

test("only an arriving new order plays sound; edit, checkout, completion and reappearing snapshots stay silent", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as typeof window & { orderToneCount: number }).orderToneCount = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args: Parameters<typeof start>) {
      (window as typeof window & { orderToneCount: number }).orderToneCount += 1;
      return start.apply(this, args);
    };
  });
  await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
  await page.setViewportSize({ width: 1024, height: 768 });
  await gotoLocalPath(page, "/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  const tones = () => page.evaluate(() => (window as typeof window & { orderToneCount: number }).orderToneCount);
  await page.getByRole("switch", { name: "新單提示音已關閉", exact: true }).click();
  await expect.poll(tones).toBeGreaterThan(0);
  const previewTones = await tones();
  const order = await createOrder(page);
  const refresh = async () => {
    const snapshot = page.waitForResponse(x => new URL(x.url()).pathname === "/api/stalls/aming-chicken/orders" && x.request().method() === "GET");
    await page.getByRole("button", { name: "重新整理", exact: true }).click();
    expect((await snapshot).status()).toBe(200);
    await expect(page.locator('button[title="重新整理"] svg')).not.toHaveClass(/animate-spin/);
  };
  await refresh();
  await expect.poll(tones).toBeGreaterThan(previewTones);
  const newOrderTones = await tones();
  for (const data of [
    { status: "CONFIRMED" as const },
    { status: "WAITING_CONFIRMATION" as const },
    { paymentStatus: "PAID" as const },
    { status: "COMPLETED" as const },
    { status: "WAITING_CONFIRMATION" as const },
  ]) {
    await prisma.order.update({ where: { id: order.id }, data });
    await refresh();
    expect(await tones()).toBe(newOrderTones);
  }
});

test("an existing preorder shows a new closure notice and a pickup-day popup without cancelling the order", async ({ page }) => {
  test.setTimeout(120_000);
  const order = await createOrder(page, true);
  const today = dateInTimeZone(new Date(), "Asia/Taipei");
  const tomorrowAt = new Date(new Date(order.pickupAt).getTime() + 24 * 60 * 60_000);
  const tomorrow = dateInTimeZone(tomorrowAt, "Asia/Taipei");
  await prisma.order.update({ where: { id: order.id }, data: { committedFulfillmentAt: tomorrowAt } });
  await page.context().addCookies([{ name: "stallorder_device", value: order.deviceId, url: order.origin }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/order/" + order.trackingToken);
  await expect(page.getByTestId("order-closure-notice")).toHaveCount(0);
  closureId = (await prisma.stallSpecialClosure.create({ data: {
    organizationId, stallId, startsOn: new Date(today), endsOn: new Date(tomorrow),
    title: "臨時店休測試", message: "請聯絡店家重新安排取餐時間。".repeat(20).slice(0, 240),
  } })).id;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("order-closure-notice")).toContainText("臨時店休測試");
  await expect(page.getByRole("alertdialog", { name: "取餐安排遇到店休公告" })).toHaveCount(0);
  await prisma.order.update({ where: { id: order.id }, data: { committedFulfillmentAt: new Date(order.pickupAt) } });
  await page.reload();
  await expect(page.getByRole("alertdialog", { name: "取餐安排遇到店休公告" })).toContainText("訂單仍保留");
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const dialog = await page.getByRole("alertdialog", { name: "取餐安排遇到店休公告" }).boundingBox();
    expect(dialog!.y).toBeGreaterThanOrEqual(0);
    expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole("button", { name: "我知道了", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "我知道了", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "我知道了", exact: true })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`pickup-day-closure-${viewport.width}.png`) });
  }
  await page.getByRole("button", { name: "我知道了", exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alertdialog", { name: "取餐安排遇到店休公告" })).toHaveCount(0);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("WAITING_CONFIRMATION");
  await prisma.stallSpecialClosure.delete({ where: { id: closureId } });
  closureId = "";
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("order-closure-notice")).toHaveCount(0);
});
