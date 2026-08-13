import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { gotoLocalPath } from "./local-navigation";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const qrToken = "demo-aming-chicken-qr-2026-rotate-me";
const qrCodeId = "33333333-3333-4333-8333-333333333333";
const capacityApiPath = `/api/stalls/${stallSlug}/capacity`;

let originalCapacity: Awaited<ReturnType<typeof loadCapacity>>;
let originalStall: Awaited<ReturnType<typeof loadStall>>;
let originalQrCodes: Awaited<ReturnType<typeof loadQrCodes>> = [];

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

async function loadQrCodes() {
  return prisma.qrCode.findMany({
    where: { stallId },
    select: { id: true, state: true, expiresAt: true },
    orderBy: { id: "asc" },
  });
}

async function waitForReactHandler(control: Locator, handler: "onClick" | "onChange") {
  await expect.poll(() => control.evaluate((element, eventName) => {
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    if (!propsKey) return false;
    const props = (element as unknown as Record<string, unknown>)[propsKey];
    return typeof props === "object"
      && props !== null
      && typeof (props as Record<string, unknown>)[eventName] === "function";
  }, handler), { message: `等待 React 掛載 ${handler}` }).toBe(true);
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
    prisma.qrCode.updateMany({
      where: { stallId },
      data: { state: "ACTIVE", expiresAt: null },
    }),
  ]);
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
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
    [originalCapacity, originalStall, originalQrCodes] = await Promise.all([
      loadCapacity(),
      loadStall(),
      loadQrCodes(),
    ]);
  });

  test.beforeEach(async () => {
    await resetOpenCapacity();
  });

  test.afterAll(async () => {
    if (originalCapacity && originalStall) {
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
        ...originalQrCodes.map((qrCode) => prisma.qrCode.update({
          where: { id: qrCode.id },
          data: { state: qrCode.state, expiresAt: qrCode.expiresAt },
        })),
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
    await expect(page.getByLabel("基本製餐時間（分鐘）")).toHaveValue("10");
    await expect(page.getByText(/負載增加時會自動提高/)).toBeVisible();
    await expect(page.getByLabel("需顧客確認門檻（分鐘）")).toHaveValue("30");
    await expect(page.getByText("商品容量規則", { exact: true })).toBeVisible();

    const prepMinutes = page.getByLabel("基本製餐時間（分鐘）");
    await prepMinutes.fill("");
    const invalidResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/merchant/stalls/${stallId}/capacity`)
      && response.request().method() === "PATCH"
    ));
    await page.getByRole("button", { name: "儲存門檻", exact: true }).click();
    expect((await invalidResponse).status()).toBe(400);
    await expect(prepMinutes).toHaveAttribute("aria-invalid", "true");
    await expect(prepMinutes).toBeFocused();
    await expect(prepMinutes).toHaveValue("");
  });

  test("店員可手動暫停及恢復公開接單", async ({ page }) => {
    await login(page, "staff@stallorder.test");
    await expect(page).toHaveURL(/\/staff\/aming-chicken/, { timeout: 30_000 });
    if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
      const warmupResponse = await page.context().request.get(capacityApiPath);
      expect(warmupResponse.status()).toBe(200);
      await warmupResponse.dispose();
    }
    await gotoLocalPath(page, `/staff/${stallSlug}`);

    const panel = page.locator("details").filter({ hasText: "產能與等候時間" }).first();
    await expect(panel).toBeVisible();
    await panel.locator("summary").click();
    await panel.getByLabel("操作原因").fill("E2E 現場人力調整");

    const pauseButton = panel.getByRole("button", { name: "暫停接單", exact: true });
    await waitForReactHandler(pauseButton, "onClick");
    const pauseResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === capacityApiPath
      && response.request().method() === "PATCH"
    ));
    await pauseButton.click();
    expect((await pauseResponse).status()).toBe(200);
    await expect(panel.getByRole("status")).toHaveText("已暫停公開接單。");
    await expect.poll(async () => (await loadCapacity()).pauseSource).toBe("MANUAL");
    await expect.poll(async () => (await loadStall()).orderingState).toBe("PAUSED");
    await expect.poll(async () => (await loadQrCode()).state).toBe("PAUSED");

    await panel.getByLabel("操作原因").fill("E2E 現場恢復正常");
    const resumeButton = panel.getByRole("button", { name: "恢復接單", exact: true });
    await waitForReactHandler(resumeButton, "onClick");
    const resumeResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === capacityApiPath
      && response.request().method() === "PATCH"
    ));
    await resumeButton.click();
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
    await expect(page.getByRole("heading", { name: "找不到此頁面", exact: true })).toBeVisible();
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
    await product.getByRole("button", { name: "加入購物車", exact: true }).click();
    await page.getByTestId("qr-mobile-cart-summary").click();
    await page.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();

    const submit = page.getByRole("button", { name: "送出訂單", exact: true });
    const acknowledgement = page.getByRole("checkbox", { name: /我已了解目前預估等候時間為 35 分鐘/ });
    await expect(acknowledgement).toBeVisible();
    await expect(submit).toBeDisabled();
    await acknowledgement.check();
    await expect(submit).toBeEnabled({ timeout: 15_000 });
  });
});
