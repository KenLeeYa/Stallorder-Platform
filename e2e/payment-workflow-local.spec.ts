import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { establishLocalTestSession, gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let paymentsUiOverrideId = "";
test.use({ serviceWorkers: "block" });
test.beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (database.port !== (process.env.CI ? "54322" : "55722") || !["127.0.0.1", "localhost"].includes(database.hostname)) {
    throw new Error("DEDICATED_LOCAL_PAYMENT_LAB_REQUIRED");
  }
  const flag = await prisma.resilienceFeatureFlag.findUniqueOrThrow({ where: { code: "PAYMENTS_ADMIN_UI_ENABLED" }, select: { id: true } });
  paymentsUiOverrideId = (await prisma.resilienceFeatureFlagOverride.create({ data: {
    flagId: flag.id, scopeType: "GLOBAL", enabled: true,
    reason: "Isolated mock payment workflow regression",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  } })).id;
});
test.beforeEach(async ({ page }) => {
  await establishLocalTestSession(page, prisma, "55555555-5555-4555-8555-555555555551");
  await gotoLocalPath(page, `/merchant/payments?organizationId=${organizationId}`);
});
test.afterAll(async () => {
  try {
    if (paymentsUiOverrideId) await prisma.resilienceFeatureFlagOverride.deleteMany({ where: { id: paymentsUiOverrideId } });
  } finally { await prisma.$disconnect(); }
});

test("付款測試連線中斷後顯示錯誤並可重試，不會永久停用按鈕", async ({ page }) => {
  await page.route("**/api/merchant/payment-integrations", (route) => route.abort("connectionfailed"));
  const configure = page.getByRole("button", { name: "建立／更新測試連線", exact: true });
  await configure.click();
  await expect(page.getByRole("alertdialog")).toContainText("建立測試連線失敗");
  await page.getByRole("alertdialog").getByRole("button", { name: "我知道了", exact: true }).click();
  await expect(configure).toBeEnabled();
  await page.unroute("**/api/merchant/payment-integrations");
  await configure.click();
  await expect(page.getByRole("dialog")).toContainText("測試連線已建立");
  await page.getByRole("dialog").getByRole("button", { name: "我知道了", exact: true }).click();
});

test("七種模擬付款結果、退款與對帳可從介面執行，失敗請求可恢復且不碰原有訂單", async ({ page }) => {
  test.setTimeout(120_000);
  const scenarios = [
    ["SUCCESS_WEBHOOK_BEFORE_RETURN", "PAID", "PAID"],
    ["SUCCESS_RETURN_BEFORE_WEBHOOK", "PAID", "PAID"],
    ["PENDING", "PENDING", "UNPAID"],
    ["FAILED", "FAILED", "UNPAID"],
    ["EXPIRED", "EXPIRED", "UNPAID"],
    ["FULL_REFUND", "REFUNDED", "REFUNDED"],
    ["RECONCILIATION_MISMATCH", "RECONCILIATION_REQUIRED", "PAID"],
  ] as const;
  const samples: Array<{ id: string; orderNo: string; scenario: string; transactionStatus: string; paymentStatus: string }> = [];
  const suffix = Date.now().toString().slice(-7);
  for (const [scenario, status, paymentStatus] of scenarios) {
    const id = randomUUID();
    const order = await prisma.order.create({ data: {
      id, organizationId, stallId, orderNo: `QA-PAY-${suffix}-${samples.length + 1}`,
      trackingTokenHash: randomBytes(32).toString("hex"), idempotencyKey: randomUUID(), deviceHash: "local-payment-qa",
      customerName: "金流範例 " + scenario, note: "本機模擬付款範例，沒有真實扣款",
      source: "STAFF_POS", origin: "ONLINE_STAFF", isTest: true, status: "READY",
      subtotal: 100, total: 100, confirmationExpiresAt: new Date(Date.now() + 86400_000),
    } });
    await page.reload();
    await page.getByRole("combobox", { name: /^攤位/ }).selectOption(stallId);
    await page.getByRole("button", { name: "建立／更新測試連線", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("測試連線已建立");
    await page.getByRole("dialog").getByRole("button", { name: "我知道了", exact: true }).click();
    await page.getByRole("combobox", { name: /^未付款訂單/ }).selectOption(order.id);
    await page.getByRole("combobox", { name: /^情境/ }).selectOption(scenario);
    const run = page.getByRole("button", { name: "執行本機測試", exact: true });
    if (samples.length === 0) {
      await page.route("**/api/merchant/payment-integrations/mock", (route) => route.abort("connectionfailed"));
      await run.click();
      await expect(page.getByRole("alertdialog")).toContainText("付款流程測試失敗");
      await page.getByRole("alertdialog").getByRole("button", { name: "我知道了", exact: true }).click();
      await expect(run).toBeEnabled();
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe("UNPAID");
      await page.unroute("**/api/merchant/payment-integrations/mock");
    }
    if (samples.length === 1) {
      await page.route("**/api/merchant/payment-integrations/mock", async (route) => {
        const result = await route.fetch();
        expect(result.status()).toBe(200);
        await route.abort("connectionfailed");
      });
      await run.click();
      await expect(page.getByRole("alertdialog")).toContainText("付款流程測試失敗");
      await page.getByRole("alertdialog").getByRole("button", { name: "我知道了", exact: true }).click();
      await expect(run).toBeEnabled();
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe("PAID");
      await page.unroute("**/api/merchant/payment-integrations/mock");
    }
    const response = page.waitForResponse((item) => item.url().endsWith("/api/merchant/payment-integrations/mock") && item.request().method() === "POST");
    await run.click();
    const result = await response;
    const body = await result.json();
    expect(result.status(), JSON.stringify(body)).toBe(200);
    expect(body.transaction.status).toBe(status);
    await expect(page.getByRole("dialog")).toContainText("測試完成");
    await page.getByRole("dialog").getByRole("button", { name: "我知道了", exact: true }).click();
    await expect(run).toBeEnabled();
    const saved = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(saved.paymentStatus).toBe(paymentStatus);
    expect(saved.status).toBe("READY");
    expect(await prisma.paymentProviderTransaction.count({ where: { orderId: id } })).toBe(1);
    if (scenario === "RECONCILIATION_MISMATCH") {
      expect(await prisma.paymentReconciliationCase.count({ where: {
        transaction: { orderId: id }, caseType: "AMOUNT_MISMATCH", reviewStatus: "OPEN",
      } })).toBe(1);
    }
    samples.push({ id, orderNo: order.orderNo, scenario, transactionStatus: status, paymentStatus });
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await writeFile("artifacts/local-payment-orders-20260907.json", JSON.stringify({ testedAt: new Date().toISOString(), samples }, null, 2) + "\n");
});
