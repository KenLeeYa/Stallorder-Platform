import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";
const password = "StallOrderDemo!2026";

type OrderingSettingsSnapshot = {
  dineInEnabled: boolean;
  deliveryModuleEnabled: boolean;
  staffDeliveryEnabled: boolean;
  printModuleEnabled: boolean;
  paymentModuleEnabled: boolean;
  discountModuleEnabled: boolean;
  discountApprovalThresholdBps: number;
  takeoutPreorderEnabled: boolean;
  preorderMinLeadMinutes: number;
  preorderMaxDays: number;
  preorderSlotMinutes: number;
  lotteryEnabled: boolean;
  lotteryDiscountOptionId: string | null;
  lotteryDiscountWinRateBps: number;
};

type StallSnapshot = {
  businessStatus: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  orderingEnabled: boolean;
  orderingState: "OPEN" | "PAUSED" | "CLOSED";
  isActive: boolean;
  isSoldOut: boolean;
};

type BusinessHourSnapshot = {
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};

type QrSnapshot = {
  id: string;
  state: "ACTIVE" | "PAUSED" | "EXPIRED" | "REVOKED";
  expiresAt: Date | null;
};

let originalSettings: OrderingSettingsSnapshot | null = null;
let originalStall: StallSnapshot | null = null;
let originalHours: BusinessHourSnapshot[] = [];
let originalQr: QrSnapshot | null = null;
let temporaryDiscountId = "";
let temporaryDiscountName = "";
const createdSessionTokenHashes = new Set<string>();

test.describe("預約與抽抽樂設定的公開點餐整合", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [settings, stall, hours, qr] = await Promise.all([
      prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId },
        select: {
          dineInEnabled: true,
          deliveryModuleEnabled: true,
          staffDeliveryEnabled: true,
          printModuleEnabled: true,
          paymentModuleEnabled: true,
          discountModuleEnabled: true,
          discountApprovalThresholdBps: true,
          takeoutPreorderEnabled: true,
          preorderMinLeadMinutes: true,
          preorderMaxDays: true,
          preorderSlotMinutes: true,
          lotteryEnabled: true,
          lotteryDiscountOptionId: true,
          lotteryDiscountWinRateBps: true,
        },
      }),
      prisma.stall.findUniqueOrThrow({
        where: { id: stallId },
        select: {
          businessStatus: true,
          orderingEnabled: true,
          orderingState: true,
          isActive: true,
          isSoldOut: true,
        },
      }),
      prisma.stallBusinessHour.findMany({
        where: { stallId, organizationId },
        orderBy: { dayOfWeek: "asc" },
        select: { id: true, opensAt: true, closesAt: true, isClosed: true },
      }),
      prisma.qrCode.findUniqueOrThrow({
        where: { token: takeoutQrToken },
        select: { id: true, state: true, expiresAt: true },
      }),
    ]);

    expect(hours).toHaveLength(7);
    originalSettings = settings;
    originalStall = stall;
    originalHours = hours;
    originalQr = qr;
    temporaryDiscountName = `整合測試九折 ${Date.now()}`;

    const discount = await prisma.discountOption.create({
      data: {
        organizationId,
        stallId,
        name: temporaryDiscountName,
        rateBps: 9000,
        isEnabled: true,
        sortOrder: 10_000,
      },
      select: { id: true },
    });
    temporaryDiscountId = discount.id;

    await prisma.$transaction([
      prisma.stallOrderingSettings.update({
        where: { stallId },
        data: {
          takeoutPreorderEnabled: false,
          preorderMinLeadMinutes: 15,
          preorderMaxDays: 1,
          preorderSlotMinutes: 30,
          lotteryEnabled: false,
          lotteryDiscountOptionId: null,
          lotteryDiscountWinRateBps: 0,
        },
      }),
      prisma.stall.update({
        where: { id: stallId },
        data: {
          businessStatus: "OPEN",
          orderingEnabled: true,
          orderingState: "OPEN",
          isActive: true,
          isSoldOut: false,
        },
      }),
      prisma.stallBusinessHour.updateMany({
        where: { stallId, organizationId },
        data: { opensAt: "00:00", closesAt: "23:59", isClosed: false },
      }),
      prisma.qrCode.update({
        where: { id: qr.id },
        data: { state: "ACTIVE", expiresAt: null },
      }),
    ]);
  });

  test.afterAll(async () => {
    try {
      if (originalSettings) {
        await prisma.stallOrderingSettings.update({
          where: { stallId },
          data: originalSettings,
        });
      }
      if (originalStall) {
        await prisma.stall.update({ where: { id: stallId }, data: originalStall });
      }
      await Promise.all(originalHours.map((hour) => prisma.stallBusinessHour.update({
        where: { id: hour.id },
        data: {
          opensAt: hour.opensAt,
          closesAt: hour.closesAt,
          isClosed: hour.isClosed,
        },
      })));
      if (originalQr) {
        await prisma.qrCode.update({
          where: { id: originalQr.id },
          data: { state: originalQr.state, expiresAt: originalQr.expiresAt },
        });
      }
      if (createdSessionTokenHashes.size > 0) {
        await prisma.orderSession.deleteMany({
          where: { tokenHash: { in: [...createdSessionTokenHashes] }, orderId: null },
        });
      }
      if (temporaryDiscountId) {
        await prisma.discountOption.deleteMany({ where: { id: temporaryDiscountId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("設定經 PATCH 儲存與重載後，真實 QR 依營業狀態切換抽抽樂與預約", async ({ browser, page }) => {
    test.setTimeout(180_000);
    await login(page);

    try {
      await page.goto(`/merchant/stalls/${stallId}/settings/modules`);
      const preorderSwitch = page.getByRole("switch", { name: /外帶預約單/ });
      const lotterySwitch = page.getByRole("switch", { name: /抽抽樂推薦/ });
      await expect(preorderSwitch).toHaveAttribute("aria-checked", "false");
      await expect(lotterySwitch).toHaveAttribute("aria-checked", "false");
      await preorderSwitch.click();
      await lotterySwitch.click();

      await page.getByLabel("最少提前（分鐘）").fill("45");
      await page.getByLabel("最多預約天數").fill("5");
      await page.getByLabel("時段間隔").selectOption("60");
      await page.getByLabel("抽中折扣").selectOption({ label: temporaryDiscountName });
      await page.getByLabel("折扣中獎率（%）").fill("100");

      const saveResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
        && response.request().method() === "PATCH"
        && response.request().postDataJSON()?.operation === "UPDATE_MODULES"
      ));
      await page.getByRole("button", { name: "儲存模組開關", exact: true }).click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status()).toBe(200);
      const saveBody = saveResponse.request().postDataJSON();
      expect(saveBody).not.toHaveProperty("enabledLocales");
      expect(saveBody).toMatchObject({
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: 45,
        preorderMaxDays: 5,
        preorderSlotMinutes: 60,
        lotteryEnabled: true,
        lotteryDiscountOptionId: temporaryDiscountId,
        lotteryDiscountWinRateBps: 10_000,
      });
      await expect(page.getByRole("status")).toHaveText("模組開關已儲存。");

      await page.reload();
      await expect(page.getByRole("switch", { name: /外帶預約單/ })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("switch", { name: /抽抽樂推薦/ })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByLabel("最少提前（分鐘）")).toHaveValue("45");
      await expect(page.getByLabel("最多預約天數")).toHaveValue("5");
      await expect(page.getByLabel("時段間隔")).toHaveValue("60");
      await expect(page.getByLabel("抽中折扣")).toHaveValue(temporaryDiscountId);
      await expect(page.getByLabel("折扣中獎率（%）")).toHaveValue("100");
      await expect.poll(async () => prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId },
        select: {
          takeoutPreorderEnabled: true,
          preorderMinLeadMinutes: true,
          preorderMaxDays: true,
          preorderSlotMinutes: true,
          lotteryEnabled: true,
          lotteryDiscountOptionId: true,
          lotteryDiscountWinRateBps: true,
        },
      })).toEqual({
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: 45,
        preorderMaxDays: 5,
        preorderSlotMinutes: 60,
        lotteryEnabled: true,
        lotteryDiscountOptionId: temporaryDiscountId,
        lotteryDiscountWinRateBps: 10_000,
      });

      await verifyLiveLottery(browser);

      await page.goto(`/merchant/stalls/${stallId}/settings/operations`);
      await page.getByLabel("營業狀態").selectOption("CLOSED");
      await page.getByLabel("允許顧客點餐").check();
      await page.getByLabel("啟用此攤位").check();
      const closeResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}`
        && response.request().method() === "PATCH"
        && response.request().postDataJSON()?.operation === "UPDATE_OPERATIONS"
      ));
      await page.getByRole("button", { name: "儲存營運狀態", exact: true }).click();
      expect((await closeResponsePromise).status()).toBe(200);
      await expect(page.getByRole("status")).toHaveText("營運狀態已更新。");

      await verifyClosedPreorder(browser);
    } finally {
      await restoreThroughUi(page);
    }
  });
});

async function verifyLiveLottery(browser: Browser) {
  const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  try {
    const page = await context.newPage();
    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${takeoutQrToken}`);
    const sessionResponse = await sessionResponsePromise;
    expect([200, 201]).toContain(sessionResponse.status());
    const sessionPayload = await sessionResponse.json() as Record<string, unknown>;
    expect(sessionPayload.orderingMode).toBe("DEFAULT");
    rememberSessionToken(sessionPayload.orderSessionToken);

    const lottery = page.getByRole("region", { name: "抽抽樂推薦" });
    await expect(lottery).toBeVisible();
    const drawResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/public/lottery-draw"
      && response.request().method() === "POST"
    ));
    await lottery.getByRole("button", { name: "開始抽抽樂", exact: true }).click();
    const drawResponse = await drawResponsePromise;
    expect(drawResponse.status()).toBe(200);
    const drawPayload = await drawResponse.json() as Record<string, unknown>;
    expect(drawPayload).toMatchObject({
      ok: true,
      discountWon: true,
      discountLabel: temporaryDiscountName,
    });
    await expect(lottery.getByRole("status")).toContainText(`並抽中 ${temporaryDiscountName}！`);
  } finally {
    await context.close();
  }
}

async function verifyClosedPreorder(browser: Browser) {
  const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${takeoutQrToken}`);
    const sessionResponse = await sessionResponsePromise;
    expect([200, 201]).toContain(sessionResponse.status());
    const sessionPayload = await sessionResponse.json() as Record<string, unknown>;
    expect(sessionPayload.orderingMode).toBe("PREORDER");
    expect(sessionPayload.lotteryEnabled).not.toBe(true);
    expect(Array.isArray(sessionPayload.preorderSlots)).toBe(true);
    expect((sessionPayload.preorderSlots as unknown[]).length).toBeGreaterThan(0);
    rememberSessionToken(sessionPayload.orderSessionToken);

    await expect(page.getByText("目前為非營業時間，僅接受預約外帶。", { exact: true })).toBeVisible();
    await expect(page.getByLabel("預約取餐時間")).toBeVisible();
    await expect(page.getByLabel("預約取餐時間").locator("option")).not.toHaveCount(0);
    await expect(page.getByRole("region", { name: "抽抽樂推薦" })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

async function restoreThroughUi(page: Page) {
  if (!originalSettings || !originalStall) return;

  await page.goto(`/merchant/stalls/${stallId}/settings/modules`);
  await setSwitch(page, /外帶預約單/, originalSettings.takeoutPreorderEnabled);
  await setSwitch(page, /抽抽樂推薦/, originalSettings.lotteryEnabled);
  if (originalSettings.takeoutPreorderEnabled) {
    await page.getByLabel("最少提前（分鐘）").fill(String(originalSettings.preorderMinLeadMinutes));
    await page.getByLabel("最多預約天數").fill(String(originalSettings.preorderMaxDays));
    await page.getByLabel("時段間隔").selectOption(String(originalSettings.preorderSlotMinutes));
  }
  if (originalSettings.lotteryEnabled) {
    await page.getByLabel("抽中折扣").selectOption(originalSettings.lotteryDiscountOptionId ?? "");
    await page.getByLabel("折扣中獎率（%）").fill(String(originalSettings.lotteryDiscountWinRateBps / 100));
  }
  const modulesResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.operation === "UPDATE_MODULES"
  ));
  await page.getByRole("button", { name: "儲存模組開關", exact: true }).click();
  expect((await modulesResponsePromise).status()).toBe(200);

  await page.goto(`/merchant/stalls/${stallId}/settings/operations`);
  await page.getByLabel("營業狀態").selectOption(originalStall.businessStatus);
  await page.getByLabel("允許顧客點餐").setChecked(originalStall.orderingEnabled);
  await page.getByLabel("啟用此攤位").setChecked(originalStall.isActive);
  const operationsResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}`
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.operation === "UPDATE_OPERATIONS"
  ));
  await page.getByRole("button", { name: "儲存營運狀態", exact: true }).click();
  expect((await operationsResponsePromise).status()).toBe(200);
}

async function setSwitch(page: Page, name: RegExp, enabled: boolean) {
  const control = page.getByRole("switch", { name });
  if ((await control.getAttribute("aria-checked")) !== String(enabled)) await control.click();
}

function rememberSessionToken(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return;
  createdSessionTokenHashes.add(createHash("sha256").update(value).digest("hex"));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 30_000 });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 測試需要設定 DATABASE_URL。");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕對非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(
      process.env.STALLORDER_E2E_ENV_FILE ?? resolve(process.cwd(), ".env"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.replace(/^(["'])(.*)\1$/u, "$2");
  }
}
