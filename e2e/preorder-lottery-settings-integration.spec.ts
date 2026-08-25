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

type LotteryDiscountChanceSnapshot = {
  discountOptionId: string;
  winRateBps: number;
};

let originalSettings: OrderingSettingsSnapshot | null = null;
let originalStall: StallSnapshot | null = null;
let originalHours: BusinessHourSnapshot[] = [];
let originalQr: QrSnapshot | null = null;
let originalLotteryDiscountChances: LotteryDiscountChanceSnapshot[] = [];
let temporaryDiscountId = "";
let temporaryDiscountName = "";
let secondTemporaryDiscountId = "";
let secondTemporaryDiscountName = "";
const createdSessionTokenHashes = new Set<string>();

test.describe("預約與抽抽樂設定的公開點餐整合", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [settings, stall, hours, qr, lotteryDiscountChances] = await Promise.all([
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
      prisma.$queryRaw<LotteryDiscountChanceSnapshot[]>`
        select
          chance.discount_option_id as "discountOptionId",
          chance.win_rate_bps::integer as "winRateBps"
        from public.stall_lottery_discount_chances chance
        where chance.stall_id = ${stallId}::uuid
        order by chance.discount_option_id
      `,
    ]);

    expect(hours).toHaveLength(7);
    originalSettings = settings;
    originalStall = stall;
    originalHours = hours;
    originalQr = qr;
    originalLotteryDiscountChances = lotteryDiscountChances.length > 0
      ? lotteryDiscountChances
      : settings.lotteryDiscountOptionId && settings.lotteryDiscountWinRateBps > 0
        ? [{
            discountOptionId: settings.lotteryDiscountOptionId,
            winRateBps: settings.lotteryDiscountWinRateBps,
          }]
        : [];
    temporaryDiscountName = `整合測試九折 ${Date.now()}`;
    secondTemporaryDiscountName = `整合測試八折 ${Date.now()}`;

    const [discount, secondDiscount] = await Promise.all([
      prisma.discountOption.create({
        data: {
          organizationId,
          stallId,
          name: temporaryDiscountName,
          rateBps: 9000,
          isEnabled: true,
          sortOrder: 9_998,
        },
        select: { id: true },
      }),
      prisma.discountOption.create({
        data: {
          organizationId,
          stallId,
          name: secondTemporaryDiscountName,
          rateBps: 8000,
          isEnabled: true,
          sortOrder: 9_999,
        },
        select: { id: true },
      }),
    ]);
    temporaryDiscountId = discount.id;
    secondTemporaryDiscountId = secondDiscount.id;

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
      prisma.$executeRaw`
        delete from public.stall_lottery_discount_chances
        where stall_id = ${stallId}::uuid
      `,
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
        await prisma.$transaction(async (transaction) => {
          await transaction.stallOrderingSettings.update({
            where: { stallId },
            data: originalSettings!,
          });
          await transaction.$executeRaw`
            delete from public.stall_lottery_discount_chances
            where stall_id = ${stallId}::uuid
          `;
          if (originalLotteryDiscountChances.length > 0) {
            await transaction.$executeRaw`
              insert into public.stall_lottery_discount_chances (
                stall_id,
                discount_option_id,
                win_rate_bps
              )
              select
                ${stallId}::uuid,
                chance.discount_option_id,
                chance.win_rate_bps
              from jsonb_to_recordset(
                ${JSON.stringify(originalLotteryDiscountChances.map((chance) => ({
                  discount_option_id: chance.discountOptionId,
                  win_rate_bps: chance.winRateBps,
                })))}::jsonb
              ) as chance(discount_option_id uuid, win_rate_bps smallint)
            `;
          }
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
      if (temporaryDiscountId || secondTemporaryDiscountId) {
        await prisma.discountOption.deleteMany({
          where: { id: { in: [temporaryDiscountId, secondTemporaryDiscountId].filter(Boolean) } },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test("設定經 PATCH 儲存與重載後，真實 QR 依營業狀態切換抽抽樂與預約", async ({ browser, page }) => {
    test.setTimeout(180_000);
    await login(page);

    try {
      await page.goto(`/merchant/stalls/${stallId}/settings/online-ordering`);
      await expect(page.getByLabel("顧客公開點餐網址")).toHaveValue(/\/store\/aming-01$/);
      await expect(page.getByLabel("LINE 自動回覆內容")).toContainText("選擇線上 Menu、外帶自取或外送");
      await expect(page.getByLabel("LINE 自動回覆內容")).toContainText(/\/store\/aming-01$/);
      await expect(page.getByRole("button", { name: "複製公開點餐網址", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "複製 LINE 回覆內容", exact: true })).toBeVisible();
      const preorderSwitch = page.getByRole("switch", { name: /外帶自取（需選時段）/ });
      await expect(preorderSwitch).toHaveAttribute("aria-checked", "false");
      await preorderSwitch.click();

      await page.getByLabel("最少提前（分鐘）").fill("45");
      await page.getByLabel("最多預約天數").fill("5");
      await page.getByLabel("時段間隔").selectOption("60");
      const preorderSaveResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
        && response.request().method() === "PATCH"
        && response.request().postDataJSON()?.operation === "UPDATE_MODULES"
      ));
      await page.getByRole("button", { name: "儲存設定", exact: true }).click();
      const preorderSaveResponse = await preorderSaveResponsePromise;
      expect(preorderSaveResponse.status()).toBe(200);
      const preorderSaveBody = preorderSaveResponse.request().postDataJSON();
      expect(preorderSaveBody).not.toHaveProperty("enabledLocales");
      expect(preorderSaveBody).toMatchObject({
        view: "online-ordering",
        takeoutPreorderEnabled: true,
        preorderMinLeadMinutes: 45,
        preorderMaxDays: 5,
        preorderSlotMinutes: 60,
      });
      await expect(page.getByRole("status")).toHaveText("模組開關已儲存。");

      await page.reload();
      await expect(page.getByRole("switch", { name: /外帶自取（需選時段）/ })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByLabel("最少提前（分鐘）")).toHaveValue("45");
      await expect(page.getByLabel("最多預約天數")).toHaveValue("5");
      await expect(page.getByLabel("時段間隔")).toHaveValue("60");

      await page.goto(`/merchant/stalls/${stallId}/settings/lottery`);
      const lotterySwitch = page.getByRole("switch", { name: /抽抽樂推薦/ });
      await expect(lotterySwitch).toHaveAttribute("aria-checked", "false");
      await lotterySwitch.click();
      await page.getByTestId(`lottery-discount-row-${temporaryDiscountId}`).getByRole("checkbox").check();
      await page.getByTestId(`lottery-discount-row-${secondTemporaryDiscountId}`).getByRole("checkbox").check();
      await page.getByTestId(`lottery-discount-rate-${temporaryDiscountId}`).fill("40");
      await page.getByTestId(`lottery-discount-rate-${secondTemporaryDiscountId}`).fill("60");
      await expect(page.getByText("折扣中獎率合計 100%", { exact: true })).toBeVisible();
      await expect(page.getByText("未中獎／只推薦 0%", { exact: true })).toBeVisible();

      const lotterySaveResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
        && response.request().method() === "PATCH"
        && response.request().postDataJSON()?.operation === "UPDATE_MODULES"
      ));
      await page.getByRole("button", { name: "儲存設定", exact: true }).click();
      const lotterySaveResponse = await lotterySaveResponsePromise;
      expect(lotterySaveResponse.status()).toBe(200);
      const lotterySaveBody = lotterySaveResponse.request().postDataJSON();
      expect(lotterySaveBody).toMatchObject({
        view: "lottery",
        lotteryEnabled: true,
        lotteryDiscountOptionId: temporaryDiscountId,
        lotteryDiscountWinRateBps: 4_000,
        lotteryDiscountChances: [
          { discountOptionId: temporaryDiscountId, winRateBps: 4_000 },
          { discountOptionId: secondTemporaryDiscountId, winRateBps: 6_000 },
        ],
      });
      await expect(page.getByRole("status")).toHaveText("模組開關已儲存。");

      await page.reload();
      await expect(page.getByRole("switch", { name: /抽抽樂推薦/ })).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId(`lottery-discount-row-${temporaryDiscountId}`).getByRole("checkbox")).toBeChecked();
      await expect(page.getByTestId(`lottery-discount-row-${secondTemporaryDiscountId}`).getByRole("checkbox")).toBeChecked();
      await expect(page.getByTestId(`lottery-discount-rate-${temporaryDiscountId}`)).toHaveValue("40");
      await expect(page.getByTestId(`lottery-discount-rate-${secondTemporaryDiscountId}`)).toHaveValue("60");
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
        lotteryDiscountWinRateBps: 4_000,
      });
      await expect.poll(async () => prisma.$queryRaw<LotteryDiscountChanceSnapshot[]>`
        select
          chance.discount_option_id as "discountOptionId",
          chance.win_rate_bps::integer as "winRateBps"
        from public.stall_lottery_discount_chances chance
        where chance.stall_id = ${stallId}::uuid
        order by chance.discount_option_id
      `).toEqual([
        { discountOptionId: temporaryDiscountId, winRateBps: 4_000 },
        { discountOptionId: secondTemporaryDiscountId, winRateBps: 6_000 },
      ].sort((left, right) => left.discountOptionId.localeCompare(right.discountOptionId)));

      await verifyLiveLottery(browser);

      await page.goto(`/merchant/stalls/${stallId}/settings/discounts`);
      const discountSaveButton = page.getByRole("button", { name: `儲存 ${temporaryDiscountName}` });
      const configuredDiscountRow = discountSaveButton.locator("xpath=../..");
      await configuredDiscountRow.getByRole("switch").click();
      const disableDiscountResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
        && response.request().method() === "PATCH"
        && response.request().postDataJSON()?.operation === "UPDATE_DISCOUNT"
      ));
      await discountSaveButton.click();
      expect((await disableDiscountResponsePromise).status()).toBe(200);
      await page.goto(`/merchant/stalls/${stallId}/settings/lottery`);
      await expect(page.getByTestId(`lottery-discount-row-${temporaryDiscountId}`)).toHaveCount(0);
      await expect.poll(async () => prisma.$queryRaw<Array<{ count: number }>>`
        select count(*)::integer as count
        from public.stall_lottery_discount_chances chance
        where chance.stall_id = ${stallId}::uuid
          and chance.discount_option_id = ${temporaryDiscountId}::uuid
      `).toEqual([{ count: 0 }]);
      await expect.poll(async () => prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId },
        select: {
          lotteryDiscountOptionId: true,
          lotteryDiscountWinRateBps: true,
        },
      })).toEqual({
        lotteryDiscountOptionId: secondTemporaryDiscountId,
        lotteryDiscountWinRateBps: 6_000,
      });

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
    expect(typeof sessionPayload.orderSessionToken).toBe("string");
    if (typeof sessionPayload.orderSessionToken !== "string") {
      throw new Error("create-order-session 未回傳 orderSessionToken");
    }
    const sessionTokenHash = createHash("sha256")
      .update(sessionPayload.orderSessionToken)
      .digest("hex");

    const lottery = page.getByRole("region", { name: "抽抽樂推薦" });
    await expect(lottery).toBeVisible();
    const drawResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/public/lottery-draw"
      && response.request().method() === "POST"
    ));
    await lottery.getByRole("button", { name: "開始抽抽樂", exact: true }).click();
    const drawResponse = await drawResponsePromise;
    expect(drawResponse.status()).toBe(200);
    const resultDialog = page.getByTestId("lottery-result-dialog");
    await expect(resultDialog).toHaveAttribute("data-phase", "result", { timeout: 2_500 });

    const [draw] = await prisma.$queryRaw<Array<{
      discountLabel: string | null;
      discountOptionId: string | null;
    }>>`
      select
        draw.discount_label as "discountLabel",
        draw.discount_option_id as "discountOptionId"
      from public.public_lottery_draws draw
      join public.order_sessions session_record
        on session_record.id = draw.order_session_id
      where session_record.token_hash = ${sessionTokenHash}
      limit 1
    `;
    expect(draw).toBeDefined();
    expect([temporaryDiscountId, secondTemporaryDiscountId]).toContain(draw?.discountOptionId);
    expect([temporaryDiscountName, secondTemporaryDiscountName]).toContain(draw?.discountLabel);
    await expect(resultDialog.getByTestId("lottery-discount-result"))
      .toContainText(String(draw?.discountLabel));
    await resultDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
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
    const physicalQrSessionPromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${takeoutQrToken}`);
    const physicalQrSession = await physicalQrSessionPromise;
    expect(physicalQrSession.request().postDataJSON()).toMatchObject({ orderingMode: "DEFAULT" });
    expect(physicalQrSession.status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByRole("heading", { name: "目前無法使用此 QR Code", exact: true })).toBeVisible();
    await expect(page.getByTestId("qr-preorder-fulfillment-time-fields")).toHaveCount(0);

    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto("/store/aming-01?view=pickup");
    const sessionResponse = await sessionResponsePromise;
    expect([200, 201]).toContain(sessionResponse.status());
    expect(sessionResponse.request().postDataJSON()).toMatchObject({ orderingMode: "PREORDER" });
    const sessionPayload = await sessionResponse.json() as Record<string, unknown>;
    expect(sessionPayload.orderingMode).toBe("PREORDER");
    expect(sessionPayload.lotteryEnabled).not.toBe(true);
    expect(Array.isArray(sessionPayload.preorderSlots)).toBe(true);
    expect((sessionPayload.preorderSlots as unknown[]).length).toBeGreaterThan(0);
    rememberSessionToken(sessionPayload.orderSessionToken);

    await expect(page.getByText("目前為非營業時間，僅接受外帶自取預約。", { exact: true })).toBeVisible();
    const preorderFields = page.getByTestId("qr-preorder-fulfillment-time-fields");
    const preorderDate = preorderFields.getByLabel("預約取餐日期");
    const preorderHour = preorderFields.getByLabel("預約取餐時間－時");
    const preorderMinute = preorderFields.getByLabel("預約取餐時間－分");
    await expect(preorderDate).toHaveAttribute("type", "date");
    await expect(preorderHour.locator("option")).not.toHaveCount(0);
    await expect(preorderMinute.locator("option")).not.toHaveCount(0);
    expect((await preorderHour.locator("option").allTextContents()).every((hour) => (
      /^(?:[01]\d|2[0-3])$/.test(hour)
    ))).toBe(true);
    expect((await preorderMinute.locator("option").allTextContents()).every((minute) => (
      /^(?:[0-5]\d)$/.test(minute) && Number(minute) % 5 === 0
    ))).toBe(true);
    await expect(page.getByRole("region", { name: "抽抽樂推薦" })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((message) => !message.includes("status of 409 (Conflict)"))).toEqual([]);
  } finally {
    await context.close();
  }
}

async function restoreThroughUi(page: Page) {
  if (!originalSettings || !originalStall) return;

  await page.goto(`/merchant/stalls/${stallId}/settings/online-ordering`);
  await setSwitch(page, /外帶自取（需選時段）/, originalSettings.takeoutPreorderEnabled);
  if (originalSettings.takeoutPreorderEnabled) {
    await page.getByLabel("最少提前（分鐘）").fill(String(originalSettings.preorderMinLeadMinutes));
    await page.getByLabel("最多預約天數").fill(String(originalSettings.preorderMaxDays));
    await page.getByLabel("時段間隔").selectOption(String(originalSettings.preorderSlotMinutes));
  }
  const preorderResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.operation === "UPDATE_MODULES"
  ));
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  expect((await preorderResponsePromise).status()).toBe(200);

  await page.goto(`/merchant/stalls/${stallId}/settings/lottery`);
  await setSwitch(page, /抽抽樂推薦/, originalSettings.lotteryEnabled);
  if (originalSettings.lotteryEnabled) {
    const selectedDiscounts = page.locator('input[id^="lottery-discount-"]:checked');
    while (await selectedDiscounts.count()) await selectedDiscounts.first().uncheck();
    for (const chance of originalLotteryDiscountChances) {
      const checkbox = page.locator(`#lottery-discount-${chance.discountOptionId}`);
      if (await checkbox.count() === 0) continue;
      await checkbox.check();
      await page.getByTestId(`lottery-discount-rate-${chance.discountOptionId}`).fill(
        String(chance.winRateBps / 100),
      );
    }
  }
  const lotteryResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/stalls/${stallId}/modules`
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.operation === "UPDATE_MODULES"
  ));
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  expect((await lotteryResponsePromise).status()).toBe(200);

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
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
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
