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
const locationName = "E2E 台北夜市地點";
const locationAddress = "台北市大同區 E2E 測試路 1 號";
const publicNotice = "E2E 行程公開公告";
const cancelledNotice = "E2E 已取消行程不可公開";

let locationId = "";
let scheduleId = "";

test.describe.serial("出攤地點與行程", () => {
  test.beforeAll(async () => {
    await cleanupFixtures();
  });

  test.afterAll(async () => {
    try {
      await cleanupFixtures();
    } finally {
      await prisma.$disconnect();
    }
  });

  test("商家可建立地點與行程，公開頁只顯示安全欄位及攤位時區", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "owner@stallorder.test", /\/merchant\/dashboard/);

    await page.goto(`/merchant/stalls/${stallId}/locations`);
    await expect(page.getByRole("heading", { name: "常用出攤地點" })).toBeVisible();
    await page.getByLabel("地點名稱").fill(locationName);
    await page.getByLabel("地址").fill(locationAddress);
    await page.getByLabel("緯度（選填）").fill("25.056000");
    await page.getByLabel("經度（選填）").fill("121.515000");
    const locationResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/merchant/stalls/${stallId}/locations`)
      && response.request().method() === "PATCH"
    ));
    await page.getByRole("button", { name: "新增地點" }).click();
    expect((await locationResponse).status()).toBe(200);
    await expect(page.getByText(locationName, { exact: true })).toBeVisible();

    locationId = (await prisma.stallLocation.findFirstOrThrow({
      where: { stallId, name: locationName },
      select: { id: true },
    })).id;

    const start = futureTaipeiDate(2, 10, 0);
    const end = futureTaipeiDate(2, 13, 30);
    await page.goto(`/merchant/stalls/${stallId}/schedule`);
    await expect(page.getByRole("heading", { name: "出攤行程與接單時段" })).toBeVisible();
    await page.getByLabel("常用地點").selectOption(locationId);
    await page.getByLabel("行程開始").fill(toTaipeiDateTimeLocal(start));
    await page.getByLabel("行程結束").fill(toTaipeiDateTimeLocal(end));
    await page.getByLabel("公開臨時公告（選填）").fill(publicNotice);
    const scheduleResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/merchant/stalls/${stallId}/schedule`)
      && response.request().method() === "PATCH"
    ));
    await page.getByRole("button", { name: "建立行程" }).click();
    expect((await scheduleResponse).status()).toBe(200);
    await expect(page.getByText(publicNotice, { exact: true })).toBeVisible();

    scheduleId = (await prisma.stallSchedule.findFirstOrThrow({
      where: { stallId, specialNotice: publicNotice },
      select: { id: true },
    })).id;
    await prisma.stallSchedule.create({
      data: {
        organizationId,
        stallId,
        locationId,
        startsAt: new Date(start.getTime() + 86_400_000),
        endsAt: new Date(end.getTime() + 86_400_000),
        status: "CANCELLED",
        specialNotice: cancelledNotice,
      },
    });

    const apiResponse = await page.request.get(`/api/public/stalls/${stallSlug}/schedule`);
    expect(apiResponse.status()).toBe(200);
    const payload = await apiResponse.json();
    expect(payload.stall).not.toHaveProperty("id");
    expect(payload.stall).not.toHaveProperty("organizationId");
    expect(payload.schedules[0]).not.toHaveProperty("id");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(locationId);
    expect(serialized).not.toContain(scheduleId);
    expect(serialized).not.toContain(cancelledNotice);
    expect(serialized).not.toContain("menuOverrideId");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/s/${stallSlug}/schedule`);
    await expect(page.getByRole("heading", { name: /出攤行程/ })).toBeVisible();
    await expect(page.getByText(locationName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(publicNotice, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/10:00.*13:30/).first()).toBeVisible();
    await expect(page.getByText(cancelledNotice)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    expect(await prisma.auditLog.count({
      where: { entityType: "STALL_LOCATION", entityId: locationId, action: "STALL_LOCATION_CREATE" },
    })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({
      where: { entityType: "STALL_SCHEDULE", entityId: scheduleId, action: "STALL_SCHEDULE_CREATED" },
    })).toBeGreaterThan(0);
  });

  test("廚房角色無法存取行程管理 API", async ({ browser }) => {
    const kitchenPage = await newRolePage(browser, "kitchen@stallorder.test", /\/kitchen/);
    const status = await kitchenPage.evaluate(async (id) => (
      await fetch(`/api/merchant/stalls/${id}/schedule`, { cache: "no-store" })
    ).status, stallId);
    expect(status).toBe(403);
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
  const locations = await prisma.stallLocation.findMany({
    where: { stallId, name: locationName },
    select: { id: true },
  });
  const locationIds = locations.map((location) => location.id);
  const schedules = await prisma.stallSchedule.findMany({
    where: {
      stallId,
      OR: [
        { specialNotice: publicNotice },
        { specialNotice: cancelledNotice },
        ...(locationIds.length > 0 ? [{ locationId: { in: locationIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const scheduleIds = schedules.map((schedule) => schedule.id);
  if (scheduleIds.length > 0) {
    await prisma.qrCode.updateMany({
      where: { stallScheduleId: { in: scheduleIds } },
      data: { locationId: null, marketEventId: null, stallScheduleId: null, fulfillmentTypeContext: null },
    });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: scheduleIds } } });
    await prisma.stallSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  }
  if (locationIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: locationIds } } });
    await prisma.stallLocation.deleteMany({ where: { id: { in: locationIds } } });
  }
  locationId = "";
  scheduleId = "";
}

function futureTaipeiDate(days: number, hour: number, minute: number) {
  const nowInTaipei = new Date(Date.now() + 8 * 60 * 60_000);
  const utc = Date.UTC(
    nowInTaipei.getUTCFullYear(),
    nowInTaipei.getUTCMonth(),
    nowInTaipei.getUTCDate() + days,
    hour - 8,
    minute,
  );
  return new Date(utc);
}

function toTaipeiDateTimeLocal(value: Date) {
  const taipei = new Date(value.getTime() + 8 * 60 * 60_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${taipei.getUTCFullYear()}-${pad(taipei.getUTCMonth() + 1)}-${pad(taipei.getUTCDate())}`
    + `T${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕對非本機資料庫執行 E2E：${hostname}`);
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
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }
}
