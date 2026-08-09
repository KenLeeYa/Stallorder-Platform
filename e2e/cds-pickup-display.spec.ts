import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Prisma, PrismaClient, type OrderStatus } from "@prisma/client";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const createdOrderIds: string[] = [];
let originalSettings: Awaited<ReturnType<typeof loadSettings>>;
let preparingOrderId = "";
let preparingOrderNo = "";
let readyOrderId = "";
let readyOrderNo = "";
let otherOrganizationId = "";
let otherStallId = "";

async function loadSettings() {
  return prisma.pickupDisplaySettings.findUniqueOrThrow({ where: { stallId } });
}

async function createDisplayOrder(input: {
  status: OrderStatus;
  orderNo: string;
  createdAt?: Date;
  updatedAt?: Date;
  customerName?: string;
}) {
  const unique = randomUUID();
  const order = await prisma.order.create({
    data: {
      organizationId,
      stallId,
      orderNo: input.orderNo,
      trackingTokenHash: createHash("sha256").update(`tracking-${unique}`).digest("hex"),
      idempotencyKey: randomUUID(),
      source: "QR_MENU",
      isTest: true,
      customerName: input.customerName ?? "CDS 測試顧客",
      customerPhone: "0912345678",
      fulfillmentType: "TAKEOUT",
      status: input.status,
      paymentStatus: "UNPAID",
      subtotal: 95,
      total: 95,
      deviceHash: createHash("sha256").update(`device-${unique}`).digest("hex"),
      pickupCodeHash: createHash("sha256").update("738").digest("hex"),
      pickupCodeDisplay: "738",
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000),
      confirmedAt: ["CONFIRMED", "PREPARING", "PACKING", "READY"].includes(input.status)
        ? new Date()
        : null,
      completedAt: input.status === "COMPLETED" ? new Date() : null,
      cancelledAt: input.status === "CANCELLED" ? new Date() : null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
  });
  createdOrderIds.push(order.id);
  return order;
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.locator('input[type="email"]').fill("owner@stallorder.test");
  await page.locator('input[type="password"]').fill("StallOrderDemo!2026");
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/auth/login")
    && candidate.request().method() === "POST"
  ));
  await page.locator('button[type="submit"]').click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
}

test.beforeAll(async () => {
  originalSettings = await loadSettings();
  await prisma.pickupDisplaySettings.update({
    where: { stallId },
    data: {
      displayTokenHash: null,
      showCustomerName: true,
      showPickupCode: true,
      maskPickupCode: true,
      readyRetentionMinutes: 30,
      preparingRetentionMinutes: 180,
      enableVoice: true,
      voiceLocale: "zh-TW",
      announcementText: "請留意取餐號碼",
      themeJson: { accentColor: "#0f766e", logoUrl: "", backgroundImageUrl: "" },
      isActive: true,
    },
  });

  preparingOrderNo = `CDS-P-${Date.now().toString().slice(-6)}`;
  readyOrderNo = `CDS-R-${Date.now().toString().slice(-6)}`;
  preparingOrderId = (await createDisplayOrder({ status: "PREPARING", orderNo: preparingOrderNo })).id;
  readyOrderId = (await createDisplayOrder({ status: "READY", orderNo: readyOrderNo })).id;
  const completed = await createDisplayOrder({ status: "COMPLETED", orderNo: `CDS-C-${Date.now().toString().slice(-6)}` });
  const cancelled = await createDisplayOrder({ status: "CANCELLED", orderNo: `CDS-X-${Date.now().toString().slice(-6)}` });
  const oldDate = new Date(Date.now() - 31 * 60_000);
  const expiredReady = await createDisplayOrder({
    status: "READY",
    orderNo: `CDS-O-${Date.now().toString().slice(-6)}`,
    createdAt: oldDate,
    updatedAt: oldDate,
  });
  await prisma.payment.create({
    data: {
      organizationId,
      stallId,
      orderId: readyOrderId,
      amount: 95,
      method: "OTHER",
      status: "PAID",
      reference: "CDS-PAYMENT-REFERENCE-MUST-NOT-LEAK",
      methodLabel: "測試付款",
    },
  });
  expect(completed.id).toBeTruthy();
  expect(cancelled.id).toBeTruthy();
  expect(expiredReady.id).toBeTruthy();

  const standardPlan = await prisma.plan.findUniqueOrThrow({
    where: { code: "STANDARD" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const planVersion = standardPlan.versions[0];
  if (!planVersion) throw new Error("STANDARD plan version missing");
  const suffix = randomUUID().slice(0, 8);
  const otherOrganization = await prisma.organization.create({
    data: {
      name: "CDS cross tenant",
      slug: `cds-cross-${suffix}`,
      businessName: "CDS cross tenant",
      status: "ACTIVE",
      email: `cds-cross-${suffix}@stallorder.test`,
      phone: "0900000077",
    },
  });
  otherOrganizationId = otherOrganization.id;
  await prisma.subscription.create({
    data: {
      organizationId: otherOrganization.id,
      planId: standardPlan.id,
      planVersionId: planVersion.id,
      status: "ACTIVE",
      billingPeriodStart: new Date(Date.UTC(2026, 6, 1)),
      billingPeriodEnd: new Date(Date.UTC(2026, 7, 1)),
    },
  });
  const otherStall = await prisma.stall.create({
    data: {
      organizationId: otherOrganization.id,
      name: "CDS other stall",
      slug: `cds-other-${suffix}`,
      code: `CDS-${suffix.toUpperCase()}`,
      address: "Other address",
      location: "Other location",
    },
  });
  otherStallId = otherStall.id;
});

test.afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  if (originalSettings) {
    await prisma.pickupDisplaySettings.update({
      where: { stallId },
      data: {
        displayTokenHash: originalSettings.displayTokenHash,
        showCustomerName: originalSettings.showCustomerName,
        showPickupCode: originalSettings.showPickupCode,
        maskPickupCode: originalSettings.maskPickupCode,
        readyRetentionMinutes: originalSettings.readyRetentionMinutes,
        preparingRetentionMinutes: originalSettings.preparingRetentionMinutes,
        enableVoice: originalSettings.enableVoice,
        voiceLocale: originalSettings.voiceLocale,
        announcementText: originalSettings.announcementText,
        themeJson: originalSettings.themeJson ?? Prisma.DbNull,
        isActive: originalSettings.isActive,
      },
    });
  }
  if (otherOrganizationId) {
    await prisma.organization.deleteMany({ where: { id: otherOrganizationId } });
  }
  await prisma.$disconnect();
});

test("公開 CDS 只顯示必要欄位並即時移動與移除訂單", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: () => {
          const count = Number(window.localStorage.getItem("cds-speak-count") ?? "0");
          window.localStorage.setItem("cds-speak-count", String(count + 1));
        },
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class { lang = ""; constructor(public text: string) {} },
    });
  });
  await page.goto(`/display/${stallSlug}`);
  const preparing = page.locator('section[aria-label="製作中"]');
  const ready = page.locator('section[aria-label="可以取餐"]');
  await expect(preparing.getByText(preparingOrderNo, { exact: true })).toBeVisible();
  await expect(ready.getByText(readyOrderNo, { exact: true })).toBeVisible();
  await expect(ready.getByText("取餐碼 ••8", { exact: true })).toBeVisible();
  await expect(page.getByText("請留意取餐號碼", { exact: true })).toBeVisible();

  const payload = await page.evaluate(async (slug) => {
    const response = await fetch(`/api/public/display/${slug}`, { cache: "no-store" });
    return response.json();
  }, stallSlug);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    "customerPhone",
    "paymentStatus",
    "paymentReference",
    "auditLog",
    "staffIdentity",
    "CDS-PAYMENT-REFERENCE-MUST-NOT-LEAK",
    "0912345678",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  const publicOrders = [...payload.display.preparing, ...payload.display.ready];
  for (const order of publicOrders) {
    expect(Object.keys(order).sort()).toEqual([
      "customerName",
      "orderNo",
      "pickupCode",
      "readyAt",
      "status",
    ]);
  }
  expect(serialized).not.toContain("CDS-C-");
  expect(serialized).not.toContain("CDS-X-");
  expect(serialized).not.toContain("CDS-O-");

  await prisma.$transaction([
    prisma.order.update({ where: { id: preparingOrderId }, data: { status: "READY" } }),
    prisma.orderEvent.create({
      data: {
        organizationId,
        stallId,
        orderId: preparingOrderId,
        eventType: "ORDER_UPDATED",
        previousStatus: "PREPARING",
        newStatus: "READY",
      },
    }),
  ]);
  await expect(ready.getByText(preparingOrderNo, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(preparing.getByText(preparingOrderNo, { exact: true })).toHaveCount(0);

  await prisma.$transaction([
    prisma.order.update({ where: { id: readyOrderId }, data: { status: "COMPLETED", completedAt: new Date() } }),
    prisma.orderEvent.create({
      data: {
        organizationId,
        stallId,
        orderId: readyOrderId,
        eventType: "ORDER_UPDATED",
        previousStatus: "READY",
        newStatus: "COMPLETED",
      },
    }),
  ]);
  await expect(ready.getByText(readyOrderNo, { exact: true })).toHaveCount(0, { timeout: 15_000 });

  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem("cds-speak-count") ?? "0"))).toBeGreaterThan(0);
  const countBeforeReload = await page.evaluate(() => Number(localStorage.getItem("cds-speak-count") ?? "0"));
  await page.reload();
  await expect(page.locator('section[aria-label="可以取餐"]')).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(await page.evaluate(() => Number(localStorage.getItem("cds-speak-count") ?? "0"))).toBe(countBeforeReload);
});

test("CDS 即時連線中斷時以輪詢同步", async ({ page }) => {
  await page.route("**/api/public/display/*/stream", (route) => route.abort());
  await page.goto(`/display/${stallSlug}`);
  await expect(page.getByText("輪詢同步", { exact: true })).toBeVisible({ timeout: 10_000 });
  const order = await createDisplayOrder({
    status: "PREPARING",
    orderNo: `CDS-F-${Date.now().toString().slice(-6)}`,
  });
  await expect(page.locator('section[aria-label="製作中"]').getByText(order.orderNo, { exact: true })).toBeVisible({ timeout: 18_000 });
});

test("管理者可輪替與撤銷 Token，且跨組織管理遭拒", async ({ page }) => {
  await loginAsOwner(page);
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
    const warmupResponse = await page.context().request.get(
      `/api/merchant/stalls/${stallId}/display`,
    );
    expect(warmupResponse.status()).toBe(200);
    await warmupResponse.dispose();
  }
  await page.goto(`/merchant/stalls/${stallId}/display`);
  await expect(page.getByRole("heading", { name: "CDS 取餐顯示" })).toBeVisible();
  const saveSettingsButton = page.getByRole("button", { name: "儲存設定", exact: true });
  await waitForReactHydration(saveSettingsButton);

  const preparingRetentionField = page.getByLabel("製作中保留時間（分鐘）");
  await preparingRetentionField.fill("");
  const blankSettingsResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}/display`)
    && response.request().method() === "PATCH"
  ));
  await saveSettingsButton.click();
  expect((await blankSettingsResponse).status()).toBe(400);
  await expect(page.getByText("「製作中保留時間」輸入不正確，請依欄位限制重新輸入。", { exact: true }).first()).toBeVisible();
  await expect(preparingRetentionField).toHaveAttribute("aria-invalid", "true");
  await expect(preparingRetentionField).toBeFocused();
  await expect(preparingRetentionField).toHaveValue("");
  await preparingRetentionField.fill("180");

  const voiceLocaleField = page.getByLabel("語音語系");
  await voiceLocaleField.fill("中文語系");
  const invalidLocaleResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}/display`)
    && response.request().method() === "PATCH"
  ));
  await saveSettingsButton.click();
  expect((await invalidLocaleResponse).status()).toBe(400);
  await expect(page.getByText("「語音語系」輸入不正確，請依欄位限制重新輸入。", { exact: true }).first()).toBeVisible();
  await expect(voiceLocaleField).toHaveAttribute("aria-invalid", "true");
  await expect(voiceLocaleField).toBeFocused();
  await expect(voiceLocaleField).toHaveValue("中文語系");
  await voiceLocaleField.fill("zh-TW");

  const rotateResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}/display`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "輪替 Token", exact: true }).click();
  const rotateResponse = await rotateResponsePromise;
  expect(rotateResponse.status()).toBe(200);
  const rotatePayload = await rotateResponse.json() as { displayToken: string };
  expect(rotatePayload.displayToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  await expect(page.getByText("顯示 Token 已輪替，舊連結已失效。", { exact: true })).toHaveAttribute("role", "status");
  const tokenResponse = await page.request.get(`/api/public/display/q/${encodeURIComponent(rotatePayload.displayToken)}`);
  expect(tokenResponse.status()).toBe(200);

  const crossStallStatus = await page.evaluate(async (targetStallId) => (
    await fetch(`/api/merchant/stalls/${targetStallId}/display`, { cache: "no-store" })
  ).status, otherStallId);
  expect(crossStallStatus).toBe(404);

  page.once("dialog", (dialog) => void dialog.accept());
  const revokeResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}/display`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "撤銷", exact: true }).click();
  expect((await revokeResponsePromise).status()).toBe(200);
  await expect(page.getByText("顯示 Token 已撤銷。", { exact: true })).toHaveAttribute("role", "status");
  const revokedResponse = await page.request.get(`/api/public/display/q/${encodeURIComponent(rotatePayload.displayToken)}`);
  expect(revokedResponse.status()).toBe(404);

  const audits = await prisma.auditLog.count({
    where: {
      stallId,
      action: { in: ["PICKUP_DISPLAY_TOKEN_ROTATED", "PICKUP_DISPLAY_TOKEN_REVOKED"] },
    },
  });
  expect(audits).toBeGreaterThanOrEqual(2);
});

async function waitForReactHydration(control: Locator) {
  await expect.poll(() => control.evaluate((element) => (
    Object.keys(element).some((key) => (
      key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
    ))
  )), { message: "等待 React 完成控制項 hydration" }).toBe(true);
}
