import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../src/lib/prisma";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const password = "StallOrderDemo!2026";
let orderId = "";
let orderNo = "";
let alternatePaymentOptionId = "";

test.describe("圖片上傳與付款更正 API 回應契約", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const owner = await prisma.profile.findUniqueOrThrow({
      where: { email: "owner@stallorder.test" },
      select: { id: true },
    });
    const paymentOptions = await prisma.paymentOption.findMany({
      where: { stallId, isEnabled: true, kind: { not: "CASH" } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    });
    const currentPayment = paymentOptions[0];
    const alternatePayment = paymentOptions[1];
    if (!currentPayment || !alternatePayment) throw new Error("E2E_NONCASH_PAYMENT_OPTIONS_MISSING");

    const now = new Date();
    const token = randomUUID();
    const order = await prisma.order.create({
      data: {
        organizationId,
        stallId,
        orderNo: `JSON-QA-${Date.now().toString().slice(-8)}`,
        trackingTokenHash: createHash("sha256").update(token).digest("hex"),
        idempotencyKey: randomUUID(),
        source: "STAFF_POS",
        origin: "ONLINE_STAFF",
        isTest: true,
        customerName: "JSON 契約 QA",
        fulfillmentType: "TAKEOUT",
        status: "COMPLETED",
        paymentStatus: "PAID",
        subtotal: 130,
        total: 130,
        deviceHash: "json-contract-e2e",
        confirmationExpiresAt: new Date(now.getTime() + 10 * 60_000),
        confirmedAt: now,
        completedAt: now,
        paidAt: now,
        items: {
          create: {
            organizationId,
            stallId,
            name: "JSON 契約測試商品",
            baseUnitPrice: 130,
            unitPrice: 130,
            quantity: 1,
            status: "READY",
          },
        },
        payment: {
          create: {
            organizationId,
            stallId,
            paymentOptionId: currentPayment.id,
            amount: 130,
            method: "OTHER",
            methodLabel: currentPayment.name,
            status: "PAID",
            recordedById: owner.id,
            paidAt: now,
          },
        },
      },
      select: { id: true, orderNo: true },
    });
    orderId = order.id;
    orderNo = order.orderNo;
    alternatePaymentOptionId = alternatePayment.id;
  });

  test.afterAll(async () => {
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.$disconnect();
  });

  test("圖片 API 回傳 HTML 時顯示可追蹤錯誤而非 JSON 解析訊息", async ({ page }) => {
    await login(page);
    await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
    await page.getByRole("button", { name: "新增商品", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新增商品" });
    await editor.locator('input[type="file"][accept*="image/png"]').setInputFiles("public/icons/stallorder-512.png");

    await page.route("**/api/merchant/organizations/*/catalog/image", async (route) => {
      await route.fulfill({
        status: 502,
        headers: { "content-type": "text/html", "x-request-id": "request-image-qa" },
        body: "<!DOCTYPE html><title>Upstream error</title>",
      });
    });
    const cropEditor = page.getByRole("dialog", { name: "調整商品圖片" });
    await cropEditor.getByRole("button", { name: "裁切並上傳", exact: true }).click();

    await expect(cropEditor.getByRole("alert")).toContainText("圖片上傳失敗。（HTTP 502，追蹤編號 request-image-qa）");
    await expect(cropEditor).not.toContainText("Unexpected token");
  });

  test("圖片 API 成功時會更新商品草稿並關閉裁切視窗", async ({ page }) => {
    await login(page);
    await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
    await page.getByRole("button", { name: "新增商品", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新增商品" });
    await editor.locator('input[type="file"][accept*="image/png"]').setInputFiles("public/icons/stallorder-512.png");

    await page.route("**/api/merchant/organizations/*/catalog/image", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          imageUrl: "https://storage.example.test/product-images/qa.webp",
          originalSize: 1024,
          optimizedSize: 512,
        }),
      });
    });
    const cropEditor = page.getByRole("dialog", { name: "調整商品圖片" });
    await cropEditor.getByRole("button", { name: "裁切並上傳", exact: true }).click();

    await expect(cropEditor).toHaveCount(0);
    await expect(editor.getByRole("status")).toContainText("商品圖片已上傳，儲存商品後生效。");
    await expect(editor.getByLabel("圖片網址")).toHaveValue("https://storage.example.test/product-images/qa.webp");
  });

  test("空白付款錯誤回應不會顯示 Unexpected end of JSON input", async ({ page }) => {
    await login(page);
    await openPaymentCorrection(page);
    await page.route(`**/api/stalls/${stallSlug}/completed-orders`, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 500, body: "" });
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: "確認執行", exact: true }).click();

    const correctionError = page.getByText("目前無法更新此訂單。（HTTP 500）", { exact: true });
    await expect(correctionError).toBeVisible();
    await expect(correctionError).not.toContainText("Unexpected end of JSON input");
  });

  test("付款方式更正可通過真實資料庫限制並完成更新", async ({ page }) => {
    await login(page);
    await openPaymentCorrection(page);
    const responsePromise = page.waitForResponse((response) => (
      response.url().endsWith(`/api/stalls/${stallSlug}/completed-orders`)
      && response.request().method() === "PATCH"
    ));

    await page.getByRole("button", { name: "確認執行", exact: true }).click();
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    await expect(page.getByText("訂單已更新。", { exact: true })).toBeVisible();
    await expect.poll(async () => (
      await prisma.payment.findUnique({ where: { orderId }, select: { paymentOptionId: true, reconciliationStatus: true } })
    )).toEqual({ paymentOptionId: alternatePaymentOptionId, reconciliationStatus: null });
  });
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
}

async function openPaymentCorrection(page: Page) {
  await page.goto(`/staff/${stallSlug}`);
  await page.getByRole("button", { name: /已完成訂單查詢/ }).click();
  await page.getByPlaceholder("訂單編號、顧客或電話").fill(orderNo);
  await page.getByRole("button", { name: "查詢", exact: true }).click();
  const order = page.getByRole("article").filter({ hasText: orderNo });
  await expect(order).toBeVisible();
  await order.getByRole("button", { name: new RegExp(`#${orderNo}`) }).click();
  await order.getByRole("button", { name: "更正付款方式", exact: true }).click();
  await order.getByLabel("新的付款方式").selectOption(alternatePaymentOptionId);
  await order.getByLabel("更正原因").fill("本機 JSON 契約驗證");
}
