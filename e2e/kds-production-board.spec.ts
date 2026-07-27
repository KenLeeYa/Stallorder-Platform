import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let orderId = "";
let orderNo = "";
let productName = "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/auth/login")
    && candidate.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await response).status()).toBe(200);
}

test.beforeAll(async () => {
  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId, stallProducts: { some: { stallId, isEnabled: true } } },
    select: { id: true, name: true },
  });
  const unique = randomUUID();
  const order = await prisma.order.create({
    data: {
      organizationId,
      stallId,
      orderNo: `KDS-${Date.now().toString().slice(-6)}`,
      trackingTokenHash: createHash("sha256").update(unique).digest("hex"),
      idempotencyKey: randomUUID(),
      source: "QR_MENU",
      isTest: true,
      customerName: "KDS QA 顧客",
      fulfillmentType: "TAKEOUT",
      status: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      subtotal: 95,
      total: 95,
      deviceHash: createHash("sha256").update(`device-${unique}`).digest("hex"),
      pickupCodeHash: createHash("sha256").update("738").digest("hex"),
      pickupCodeDisplay: "738",
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  orderId = order.id;
  orderNo = order.orderNo;
  productName = product.name;
  await prisma.orderItem.create({
    data: {
      organizationId,
      stallId,
      orderId,
      productId: product.id,
      name: product.name,
      baseUnitPrice: 95,
      unitPrice: 95,
      quantity: 2,
      note: "切小塊",
    },
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { status: "CONFIRMED", confirmedAt: new Date(Date.now() - 6 * 60_000) },
  });
});

test.afterAll(async () => {
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.$disconnect();
});

test("KDS 即時事件流使用獨立權限邊界", async ({ page }) => {
  await login(page, "kitchen@stallorder.test");
  await expect(page).toHaveURL(/\/kitchen\?stall=aming-chicken/);
  await expect(page.getByText("即時連線", { exact: true })).toBeVisible();
  const generalStreamStatus = await page.evaluate(async () => (
    await fetch("/api/stalls/aming-chicken/orders/stream", { cache: "no-store" })
  ).status);
  expect(generalStreamStatus).toBe(403);
});

test("廚房角色可在手機 KDS 操作且只取得安全欄位", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const sentinel = new EventTarget() as EventTarget & { release: () => Promise<void> };
    sentinel.release = async () => {
      sentinel.dispatchEvent(new Event("release"));
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => sentinel },
    });
  });
  let blockKitchenStream = true;
  await page.route("**/api/stalls/*/kitchen/stream", (route) => (
    blockKitchenStream ? route.abort() : route.continue()
  ));
  await login(page, "kitchen@stallorder.test");
  await expect(page).toHaveURL(/\/kitchen\?stall=aming-chicken/);
  await expect(page.getByRole("heading", { name: "廚房生產系統" })).toBeVisible();
  await expect(page.getByText("輪詢備援", { exact: true })).toBeVisible();
  const board = page.locator("main").last();
  const soundButton = board.getByTitle("開啟新訂單聲音與震動");
  await expect(soundButton).toBeVisible();
  await soundButton.click();
  await expect(board.getByTitle("關閉新訂單聲音與震動")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("stallorder_kitchen_order_alerts"))).toBe("enabled");
  const wakeButton = board.getByTitle("開啟螢幕保持喚醒");
  await expect(wakeButton).toBeVisible();
  await wakeButton.click();
  await expect(board.getByTitle("關閉螢幕保持喚醒")).toBeVisible();
  const refreshResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/kitchen/board")
    && response.request().method() === "GET"
  ));
  await board.getByTitle("重新整理").click();
  expect((await refreshResponse).status()).toBe(200);
  await expect(board.getByTitle("登出")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  blockKitchenStream = false;
  await expect(page.getByText("即時連線", { exact: true })).toBeVisible({ timeout: 10_000 });
  const orderCard = page.getByRole("article").filter({ hasText: "#" + orderNo });
  await expect(orderCard.getByText("等候警示", { exact: true })).toBeVisible();
  await expect(orderCard.getByText("取餐 738", { exact: true })).toBeVisible();
  await expect(orderCard.getByText("備註：切小塊", { exact: true })).toBeVisible();

  const safePayload = await page.evaluate(async () => {
    const response = await fetch("/api/stalls/aming-chicken/kitchen/board", { cache: "no-store" });
    if (!response.ok) throw new Error("KDS board request failed");
    return response.json();
  });
  const serialized = JSON.stringify(safePayload);
  for (const forbidden of ["customerPhone", "deliveryAddress", "paymentStatus", "subtotal", "discountAmount", "total"]) {
    expect(serialized).not.toContain(`\"${forbidden}\"`);
  }

  const generalOrderStatus = await page.evaluate(async () => (
    await fetch("/api/stalls/aming-chicken/orders", { cache: "no-store" })
  ).status);
  expect(generalOrderStatus).toBe(403);

  await page.getByRole("button", { name: "品項", exact: true }).click();
  const itemAggregate = page.getByRole("article")
    .filter({ hasText: productName })
    .filter({ hasText: "切小塊" });
  await expect(itemAggregate).toBeVisible();
  await expect(itemAggregate.getByText(/^× \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "工作站", exact: true }).click();
  await expect(page.getByLabel("工作站")).toBeVisible();
  await page.getByRole("button", { name: "訂單", exact: true }).click();

  const taskResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/kitchen/tasks")
    && response.request().method() === "PATCH"
  ));
  await orderCard.getByRole("button", { name: "開始製作", exact: true }).click();
  expect((await taskResponse).status()).toBe(200);
  await expect(orderCard.getByText("製作中", { exact: true })).toBeVisible();

  await page.goto(`/merchant/stalls/${stallId}/kitchen/stations`);
  await expect(page.getByText("404", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "工作站與品項分流" })).toHaveCount(0);
  await page.goto("/kitchen?stall=aming-chicken");
  await page.locator("main").last().getByTitle("登出").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("攤位管理者可進入工作站與 KDS 設定", async ({ page }) => {
  await login(page, "owner@stallorder.test");
  await page.goto("/kitchen/stations?stall=aming-chicken");
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/kitchen/stations$`));
  await expect(page.getByRole("link", { name: "返回攤位設定", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工作站與品項分流" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "綜合工作站", exact: true }).last()).toBeVisible();
  await page.goto("/kitchen/settings?stall=aming-chicken");
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/kitchen/settings$`));
  await expect(page.getByRole("link", { name: "返回攤位設定", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "KDS 顯示設定" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "警示時間（分鐘）", exact: true }).last()).toHaveValue("5");
  await expect(page.getByRole("spinbutton", { name: "嚴重逾時（分鐘）", exact: true }).last()).toHaveValue("10");
});
