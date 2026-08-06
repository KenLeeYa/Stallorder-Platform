import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const password = "StallOrderDemo!2026";
const financeEmail = "cash.finance.e2e@stallorder.test";
const customerName = "Cash shift E2E customer";
let financeProfileId = "";
let shiftId = "";
let orderId = "";

test.describe.serial("現金交班與短溢收", () => {
  test.beforeAll(async () => {
    await cleanupFixtures();
    const owner = await prisma.profile.findUniqueOrThrow({
      where: { email: "owner@stallorder.test" },
      select: { passwordHash: true },
    });
    if (!owner.passwordHash) throw new Error("示範 owner 缺少密碼雜湊");
    const finance = await prisma.profile.create({
      data: {
        email: financeEmail,
        displayName: "E2E 現金財務檢視者",
        passwordHash: owner.passwordHash,
      },
    });
    financeProfileId = finance.id;
    await prisma.organizationMembership.create({
      data: {
        organizationId,
        profileId: finance.id,
        role: "FINANCE_VIEWER",
        allStalls: true,
      },
    });
  });

  test.afterAll(async () => {
    try {
      await cleanupFixtures();
      await prisma.authSession.deleteMany({ where: { profileId: financeProfileId || undefined } });
      await prisma.profile.deleteMany({ where: { email: financeEmail } });
      await prisma.rateLimitBucket.deleteMany();
    } finally {
      await prisma.$disconnect();
    }
  });

  test("店員現金收款、退款與關班後由老闆複核", async ({ browser, page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "staff@stallorder.test", /\/staff\/aming-chicken/);
    await page.goto(`/staff/${stallSlug}/cash`);
    await page.getByLabel("開班金額").fill("1000");
    await page.getByLabel("備註（選填）").fill("Cash shift E2E 班次");
    await page.getByRole("button", { name: "開始班次" }).click();
    await expect(page.getByText("班次進行中", { exact: true })).toBeVisible();
    shiftId = (await prisma.cashShift.findFirstOrThrow({
      where: { stallId, note: "Cash shift E2E 班次" },
      orderBy: { openedAt: "desc" },
      select: { id: true },
    })).id;

    await page.goto(`/staff/${stallSlug}`);
    await page.getByRole("button", { name: "店員點餐" }).click();
    const composer = page.getByRole("dialog", { name: "店員點餐與結帳" });
    await composer.getByTitle(/^增加 /).first().click();
    const requiredGroups = composer.locator("fieldset");
    for (let index = 0; index < await requiredGroups.count(); index += 1) {
      const group = requiredGroups.nth(index);
      if ((await group.locator("legend").innerText()).includes("*")) {
        await group.locator('input[type="radio"], input[type="checkbox"]').first().check();
      }
    }
    await composer.getByLabel("顧客名稱（選填）").fill(customerName);
    await composer.getByTestId("staff-mobile-cart-summary").click();
    await expect(composer.getByTestId("staff-order-cart-panel")).toBeVisible();
    const cashOption = composer.getByRole("button", { name: "現金", exact: true });
    if (await cashOption.count()) await cashOption.click();
    await composer.getByRole("button", { name: "剛好", exact: true }).click();
    const orderResponsePromise = page.waitForResponse((response) => (
      response.url().endsWith(`/api/stalls/${stallSlug}/orders`)
      && response.request().method() === "POST"
    ));
    await composer.getByRole("button", { name: "建立訂單並收款" }).click();
    const orderResponse = await orderResponsePromise;
    expect(orderResponse.status()).toBe(201);
    const orderPayload = await orderResponse.json();
    orderId = orderPayload.order.id;
    const paidOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payment: true },
    });
    expect(paidOrder.payment?.cashShiftId).toBe(shiftId);

    await page.goto(`/staff/${stallSlug}/cash`);
    await page.getByLabel("金額", { exact: true }).fill("200");
    await page.getByLabel("原因", { exact: true }).fill("補入零用金");
    const movementButton = page.getByRole("button", { name: "新增紀錄" });
    const cashInResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/stalls/${stallSlug}/cash-shifts`)
      && response.request().method() === "POST"
    ));
    await movementButton.click();
    expect((await cashInResponse).status()).toBe(200);
    await expect(page.getByText(/補入零用金/)).toBeVisible();
    await page.getByLabel("類型").selectOption("CASH_OUT");
    await page.getByLabel("金額", { exact: true }).fill("50");
    await page.getByLabel("原因", { exact: true }).fill("臨時採買");
    const cashOutResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/stalls/${stallSlug}/cash-shifts`)
      && response.request().method() === "POST"
    ));
    await movementButton.click();
    expect((await cashOutResponse).status()).toBe(200);
    await expect(page.getByText(/臨時採買/)).toBeVisible();

    await page.getByLabel("原付款").selectOption(paidOrder.payment!.id);
    await page.getByLabel("退款原因").fill("顧客取消餐點");
    await page.getByRole("button", { name: "確認退款" }).click();
    await expect(page.getByRole("status")).toContainText("現金退款已記錄");
    await page.getByLabel("實際盤點金額").fill("1100");
    await expect(page.getByText("短收", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "送出交班複核" }).click();
    await expect(page.getByText("等待複核", { exact: true })).toBeVisible();

    const pending = await prisma.cashShift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(pending.status).toBe("CLOSING");
    expect(pending.systemExpectedAmount).toBe(1150);
    expect(pending.countedAmount).toBe(1100);
    expect(pending.varianceAmount).toBe(-50);

    const ownerPage = await newRolePage(browser, "owner@stallorder.test", /\/merchant\/dashboard\?organizationId=/);
    await ownerPage.goto(`/staff/${stallSlug}/cash`);
    const shiftRecord = ownerPage.getByRole("article").filter({ hasText: "Cash shift E2E 班次" });
    await expect(shiftRecord).toContainText("等待複核");
    await shiftRecord.getByRole("button", { name: "核准結班" }).click();
    await expect(shiftRecord.getByText("已結班", { exact: true })).toBeVisible();
    await ownerPage.context().close();

    const completed = await prisma.cashShift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { reviews: true },
    });
    expect(completed.status).toBe("CLOSED");
    expect(completed.reviews.at(-1)?.decision).toBe("APPROVED");
  });

  test("財務角色唯讀，廚房角色無法存取現金資料", async ({ browser }) => {
    const financePage = await newRolePage(browser, financeEmail, /\/merchant\/dashboard/);
    await financePage.goto(`/staff/${stallSlug}/cash`);
    await expect(financePage.getByText(/目前為唯讀模式/)).toBeVisible();
    await expect(financePage.getByRole("button", { name: "開始班次" })).toHaveCount(0);
    await financePage.goto(`/merchant/reports/cash-shifts?organizationId=${organizationId}&stallId=${stallId}`);
    await expect(financePage.getByRole("heading", { name: "現金交班與短溢收" })).toBeVisible();
    const reportRow = financePage.getByRole("article").filter({ hasText: "$1,150" });
    await expect(reportRow).toContainText("已結班");
    await expect(reportRow).toContainText("-$50");
    await financePage.context().close();

    const kitchenPage = await newRolePage(browser, "kitchen@stallorder.test", /\/kitchen/);
    const apiStatus = await kitchenPage.evaluate(async (slug) => (
      await fetch(`/api/stalls/${slug}/cash-shifts`, { cache: "no-store" })
    ).status, stallSlug);
    expect(apiStatus).toBe(403);
    await kitchenPage.goto(`/staff/${stallSlug}/cash`);
    await expect(kitchenPage.getByText("404", { exact: true }).last()).toBeVisible();
    await kitchenPage.context().close();
  });
});

async function newRolePage(browser: Browser, email: string, destination: RegExp) {
  const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const page = await context.newPage();
  await login(page, email, destination);
  return page;
}

async function login(page: Page, email: string, destination: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL(destination, { timeout: 30_000 });
}

async function cleanupFixtures() {
  const shifts = await prisma.cashShift.findMany({
    where: { stallId, note: { startsWith: "Cash shift E2E" } },
    select: { id: true },
  });
  const shiftIds = shifts.map((shift) => shift.id);
  await prisma.order.deleteMany({ where: { stallId, customerName } });
  if (shiftIds.length > 0) {
    await prisma.cashShiftReview.deleteMany({ where: { cashShiftId: { in: shiftIds } } });
    await prisma.cashShift.deleteMany({ where: { id: { in: shiftIds } } });
  }
  await prisma.operationalAlert.deleteMany({
    where: { stallId, alertType: { in: ["CASH_SHIFT_NOT_CLOSED", "CASH_OVER_SHORT"] } },
  });
  await prisma.authSession.deleteMany({ where: { profile: { email: financeEmail } } });
  await prisma.profile.deleteMany({ where: { email: financeEmail } });
  shiftId = "";
  orderId = "";
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
}
