import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const qrToken = "demo-aming-chicken-qr-2026-rotate-me";
const qrCodeId = "33333333-3333-4333-8333-333333333333";

let originalCapacity: Awaited<ReturnType<typeof loadCapacity>>;
let originalStall: Awaited<ReturnType<typeof loadStall>>;
let originalQrCode: Awaited<ReturnType<typeof loadQrCode>>;

async function loadCapacity() {
  return prisma.stallCapacitySettings.findUniqueOrThrow({ where: { stallId } });
}

async function loadStall() {
  return prisma.stall.findUniqueOrThrow({
    where: { id: stallId },
    select: {
      orderingEnabled: true,
      orderingState: true,
      businessStatus: true,
      isSoldOut: true,
    },
  });
}

async function loadQrCode() {
  return prisma.qrCode.findUniqueOrThrow({
    where: { id: qrCodeId },
    select: { state: true, expiresAt: true },
  });
}

async function resetOpenCapacity() {
  await prisma.$transaction([
    prisma.stallCapacitySettings.update({
      where: { stallId },
      data: {
        manualWaitMinutes: 35,
        acknowledgmentThresholdMinutes: 30,
        autoPauseEnabled: false,
        autoResumeEnabled: false,
        pauseSource: "NONE",
        isActive: true,
      },
    }),
    prisma.stall.update({
      where: { id: stallId },
      data: {
        orderingEnabled: true,
        orderingState: "OPEN",
        businessStatus: "OPEN",
        isSoldOut: false,
      },
    }),
    prisma.qrCode.update({
      where: { id: qrCodeId },
      data: { state: "ACTIVE", expiresAt: null },
    }),
  ]);
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
}

test.describe.serial("產能與等候時間", () => {
  test.beforeAll(async () => {
    [originalCapacity, originalStall, originalQrCode] = await Promise.all([
      loadCapacity(),
      loadStall(),
      loadQrCode(),
    ]);
  });

  test.beforeEach(async () => {
    await resetOpenCapacity();
  });

  test.afterAll(async () => {
    if (originalCapacity && originalStall && originalQrCode) {
      await prisma.$transaction([
        prisma.stallCapacitySettings.update({
          where: { stallId },
          data: {
            windowMinutes: originalCapacity.windowMinutes,
            maxOrdersPerWindow: originalCapacity.maxOrdersPerWindow,
            maxItemsPerWindow: originalCapacity.maxItemsPerWindow,
            warningUtilizationPercent: originalCapacity.warningUtilizationPercent,
            pauseUtilizationPercent: originalCapacity.pauseUtilizationPercent,
            defaultPrepMinutes: originalCapacity.defaultPrepMinutes,
            minimumQuoteMinutes: originalCapacity.minimumQuoteMinutes,
            maximumQuoteMinutes: originalCapacity.maximumQuoteMinutes,
            quoteBufferMinutes: originalCapacity.quoteBufferMinutes,
            acknowledgmentThresholdMinutes: originalCapacity.acknowledgmentThresholdMinutes,
            manualWaitMinutes: originalCapacity.manualWaitMinutes,
            autoPauseEnabled: originalCapacity.autoPauseEnabled,
            autoResumeEnabled: originalCapacity.autoResumeEnabled,
            pauseSource: originalCapacity.pauseSource,
            isActive: originalCapacity.isActive,
          },
        }),
        prisma.stall.update({ where: { id: stallId }, data: originalStall }),
        prisma.qrCode.update({ where: { id: qrCodeId }, data: originalQrCode }),
      ]);
    }
    await prisma.$disconnect();
  });

  test("商家可檢視完整容量設定與商品規則", async ({ page }) => {
    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/stalls/${stallId}/capacity`);

    await expect(page.getByRole("heading", { name: "產能與等候時間", exact: true })).toBeVisible();
    await expect(page.getByText("即時負載", { exact: true })).toBeVisible();
    await expect(page.getByText("等候時間與容量門檻", { exact: true })).toBeVisible();
    await expect(page.getByLabel("需顧客確認門檻（分鐘）")).toHaveValue("30");
    await expect(page.getByText("商品容量規則", { exact: true })).toBeVisible();
  });

  test("店員可手動暫停及恢復公開接單", async ({ page }) => {
    await login(page, "staff@stallorder.test");
    await expect(page).toHaveURL(/\/staff\/aming-chicken/, { timeout: 30_000 });

    const panel = page.locator("details").filter({ hasText: "產能與等候時間" }).first();
    await expect(panel).toBeVisible();
    await panel.locator("summary").click();
    await panel.getByLabel("操作原因").fill("E2E 現場人力調整");

    const pauseResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/stalls/${stallSlug}/capacity`)
      && response.request().method() === "PATCH"
    ));
    await panel.getByRole("button", { name: "暫停接單", exact: true }).click();
    expect((await pauseResponse).status()).toBe(200);
    await expect(panel.getByRole("status")).toHaveText("已暫停公開接單。");
    await expect.poll(async () => (await loadCapacity()).pauseSource).toBe("MANUAL");
    await expect.poll(async () => (await loadStall()).orderingState).toBe("PAUSED");
    await expect.poll(async () => (await loadQrCode()).state).toBe("PAUSED");

    await panel.getByLabel("操作原因").fill("E2E 現場恢復正常");
    const resumeResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/stalls/${stallSlug}/capacity`)
      && response.request().method() === "PATCH"
    ));
    await panel.getByRole("button", { name: "恢復接單", exact: true }).click();
    expect((await resumeResponse).status()).toBe(200);
    await expect(panel.getByRole("status")).toHaveText("已恢復公開接單。");
    await expect.poll(async () => (await loadCapacity()).pauseSource).toBe("NONE");
    await expect.poll(async () => (await loadStall()).orderingState).toBe("OPEN");
    await expect.poll(async () => (await loadQrCode()).state).toBe("ACTIVE");
  });

  test("廚房角色不能存取容量控制或商家設定", async ({ page }) => {
    await login(page, "kitchen@stallorder.test");
    await expect(page).toHaveURL(/\/kitchen/, { timeout: 30_000 });

    const capacityStatus = await page.evaluate(async (slug) => (
      await fetch(`/api/stalls/${encodeURIComponent(slug)}/capacity`, { cache: "no-store" })
    ).status, stallSlug);
    expect(capacityStatus).toBe(403);

    await page.goto(`/merchant/stalls/${stallId}/capacity`);
    await expect(page.getByText("404", { exact: true }).last()).toBeVisible();
  });

  test("高等候時間須由顧客確認後才能送出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${qrToken}`);
    const sessionResponse = await sessionResponsePromise;
    expect([200, 201]).toContain(sessionResponse.status());
    const session = await sessionResponse.json();
    expect(session).toMatchObject({
      estimatedWaitMinMinutes: 35,
      estimatedWaitMaxMinutes: 35,
      requiresWaitAcknowledgment: true,
    });

    await expect(page.getByText("目前預估等候約 35 分鐘", { exact: true })).toBeVisible();
    const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
    await product.getByRole("button", { name: "增加 香酥雞排" }).click();
    await page.getByTestId("qr-mobile-cart-summary").click();

    const submit = page.getByRole("button", { name: "送出訂單", exact: true });
    const acknowledgement = page.getByRole("checkbox", { name: /我已了解目前預估等候時間為 35 分鐘/ });
    await expect(acknowledgement).toBeVisible();
    await expect(submit).toBeDisabled();
    await acknowledgement.check();
    await expect(submit).toBeEnabled({ timeout: 15_000 });
  });
});
