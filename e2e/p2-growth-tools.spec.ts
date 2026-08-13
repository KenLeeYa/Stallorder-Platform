import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const primaryStallId = "22222222-2222-4222-8222-222222222222";
const scheduleName = "P2 E2E 每日報告";
const alertMessage = "P2 E2E 營運警示";
const paginationAlertPrefix = "P2 E2E 分頁警示";
const paginationAuditPrefix = "P2_PAGINATION_QA";

test.describe("P2 後續成長功能", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await cleanup();
  });

  test.afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test("PWA manifest、Wake Lock 與離線唯讀防線可用", async ({ page, context, request }) => {
    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({ name: "StallOrder 攤點通", display: "standalone", start_url: "/launch" });
    expect(manifest.icons).toHaveLength(2);

    const serviceWorkerResponse = await request.get("/sw.js");
    expect(serviceWorkerResponse.ok()).toBe(true);
    const serviceWorker = await serviceWorkerResponse.text();
    expect(serviceWorker).toContain('if (request.method !== "GET") return');
    expect(serviceWorker).toContain('const CACHE_NAME = "stallorder-shell-v5"');
    expect(serviceWorker).toContain('const OFFLINE_DB_NAME = "stallorder-offline-pos"');
    expect(serviceWorker).toContain('const isLegacyStorefrontNavigation = /^\\/(?:menu|s|delivery)\\/[^/]+$/.test(url.pathname)');
    expect(serviceWorker).toContain('if (isLegacyStorefrontNavigation) return');
    expect(serviceWorker).toContain('|| /^\\/store\\/[^/]+$/.test(url.pathname)');
    expect(serviceWorker).not.toContain('|| /^\\/delivery\\/[^/]+$/.test(url.pathname)');
    expect(serviceWorker).toContain('event.data?.type === "ACTIVATE_UPDATE"');
    expect(serviceWorker).toContain("countUnsynchronizedRecords");

    await page.addInitScript(() => {
      const sentinel = new EventTarget() as EventTarget & { released: boolean; release: () => Promise<void> };
      sentinel.released = false;
      sentinel.release = async () => {
        sentinel.released = true;
        sentinel.dispatchEvent(new Event("release"));
      };
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: { request: async () => sentinel },
      });
    });
    await login(page, "staff@stallorder.test");
    await page.goto("/staff/aming-chicken");
    const wakeButton = page.getByTitle("開啟螢幕保持喚醒");
    await expect(wakeButton).toBeVisible();
    await wakeButton.click();
    await expect(page.getByTitle("關閉螢幕保持喚醒")).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText(/目前離線：僅供檢視/)).toBeVisible();
    const offlineMutationResult = await page.evaluate(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown";
      }
    });
    expect(offlineMutationResult).toBe("OFFLINE_READ_ONLY");
    await context.setOffline(false);
  });

  test("翻譯完整度可篩選缺漏並開啟安全 QR 語系預覽", async ({ page }) => {
    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/localization?organizationId=${organizationId}`);
    await expect(page.getByRole("heading", { name: "翻譯完整度" })).toBeVisible();
    await page.getByRole("button", { name: /English/ }).click();
    await expect(page.getByText(/English · \d+ 項/)).toBeVisible();
    await page.getByLabel("缺漏類型").selectOption("NOTE_OPTION");

    const previewPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: /English/ }).last().click();
    const preview = await previewPromise;
    await expect(preview.getByText("English · 預覽模式")).toBeVisible();
    await expect(preview.getByText("此頁僅供商家檢查翻譯與版面，不會建立訂單。")).toBeVisible();
    expect(await prisma.orderSession.count({ where: { createdAt: { gt: new Date(Date.now() - 5_000) } } })).toBe(0);
    await preview.close();
  });

  test("營運警示可確認與解除並寫入稽核紀錄", async ({ page }) => {
    await prisma.stall.update({ where: { id: primaryStallId }, data: { businessStatus: "PAUSED", orderingEnabled: false } });
    const currentAlert = await prisma.operationalAlert.findFirst({
      where: { organizationId, stallId: primaryStallId, alertType: "ORDERING_PAUSED", status: { in: ["ACTIVE", "ACKNOWLEDGED"] } },
    });
    if (currentAlert) {
      await prisma.operationalAlert.update({ where: { id: currentAlert.id }, data: { message: alertMessage, status: "ACTIVE", acknowledgedAt: null, resolvedAt: null, detectedAt: new Date() } });
    } else {
      await prisma.operationalAlert.create({
        data: {
          organizationId,
          stallId: primaryStallId,
          alertType: "ORDERING_PAUSED",
          severity: "WARNING",
          message: alertMessage,
          status: "ACTIVE",
        },
      });
    }
    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/operations?organizationId=${organizationId}`);
    const alert = page.getByRole("article").filter({ hasText: alertMessage });
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "確認警示" }).click();
    await expect(alert.getByText("已確認", { exact: true })).toBeVisible();
    await alert.getByRole("button", { name: "標記已解除" }).click();
    await expect(alert.getByText("已解除", { exact: true })).toBeVisible();

    const record = await prisma.operationalAlert.findFirstOrThrow({ where: { organizationId, message: alertMessage } });
    expect(record.status).toBe("RESOLVED");
    expect(await prisma.auditLog.count({ where: { entityId: record.id, action: { in: ["OPERATIONAL_ALERT_ACKNOWLEDGED", "OPERATIONAL_ALERT_RESOLVED"] } } })).toBe(2);
    await prisma.stall.update({ where: { id: primaryStallId }, data: { businessStatus: "OPEN", orderingEnabled: true } });
  });

  test("稽核紀錄與營運警示可獨立調整每頁顯示數量", async ({ page }, testInfo) => {
    const now = Date.now();
    await prisma.operationalAlert.createMany({
      data: Array.from({ length: 7 }, (_, index) => ({
        organizationId,
        stallId: primaryStallId,
        alertType: "PAYMENT_MISMATCH",
        severity: "INFO",
        message: `${paginationAlertPrefix} ${index + 1}`,
        status: "RESOLVED",
        detectedAt: new Date(now + (index * 1_000)),
        resolvedAt: new Date(now + (index * 1_000)),
      })),
    });
    await prisma.auditLog.createMany({
      data: Array.from({ length: 7 }, (_, index) => ({
        organizationId,
        stallId: primaryStallId,
        action: `${paginationAuditPrefix}_${index + 1}`,
        entityType: "PAGINATION_QA",
        outcome: "SUCCESS" as const,
        requestId: `p2-pagination-${now}-${index}`,
        createdAt: new Date(now + (index * 1_000)),
      })),
    });

    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/operations?organizationId=${organizationId}&stallId=${primaryStallId}&alertStatus=RESOLVED&alertSeverity=INFO&auditOutcome=SUCCESS&auditQuery=${paginationAuditPrefix}&alertPageSize=5&auditPageSize=5`);

    const alertSection = page.locator('section[aria-labelledby="alerts-title"]');
    const auditSection = page.locator('section[aria-labelledby="audit-title"]');
    await expect(page.getByLabel("營運警示每頁顯示數量")).toHaveValue("5");
    await expect(page.getByLabel("稽核紀錄每頁顯示數量")).toHaveValue("5");
    await expect(alertSection.getByRole("article")).toHaveCount(5);
    await expect(auditSection.locator("details")).toHaveCount(5);
    await expect(alertSection.getByText("顯示 1–5，共 7 筆", { exact: true })).toBeVisible();
    await expect(auditSection.getByText("顯示 1–5，共 7 筆", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("operations-pagination.png"), fullPage: true });

    await page.getByRole("button", { name: "營運警示下一頁" }).click();
    await expect(alertSection.getByText("第 2 / 2 頁", { exact: true })).toBeVisible();
    await expect(alertSection.getByRole("article")).toHaveCount(2);
    await expect(auditSection.locator("details")).toHaveCount(5);

    await page.getByRole("button", { name: "稽核紀錄下一頁" }).click();
    await expect(auditSection.getByText("第 2 / 2 頁", { exact: true })).toBeVisible();
    await expect(auditSection.locator("details")).toHaveCount(2);
    await page.getByLabel("稽核紀錄每頁顯示數量").selectOption("10");
    await expect(page.getByLabel("稽核紀錄每頁顯示數量")).toHaveValue("10");
    await expect(auditSection.getByText("第 1 / 1 頁", { exact: true })).toBeVisible();
    await expect(auditSection.locator("details")).toHaveCount(7);
  });

  test("報表排程可建立並完成本機模擬寄送", async ({ page }) => {
    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/report-schedules?organizationId=${organizationId}`);
    await expect(page.getByText(/目前為本機模擬模式/)).toBeVisible();
    await page.getByRole("button", { name: "新增排程" }).click();
    await page.getByLabel("排程名稱").fill(scheduleName);
    await page.getByLabel("報告類型").selectOption("DAILY_SALES");
    await page.getByLabel("寄送時間").fill("08:30");
    await page.getByLabel("收件人 Email").fill("p2-report@stallorder.test");
    await page.getByRole("button", { name: "儲存排程" }).click();
    await expect(page.getByText("報表排程已建立。")).toBeVisible();
    const scheduleArticle = page.getByRole("article").filter({ hasText: scheduleName });
    await expect(scheduleArticle).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await scheduleArticle.getByTitle("測試寄送").click();
    await expect(page.getByText("本機模擬寄送完成，未寄出真實 Email。")).toBeVisible();
    await scheduleArticle.getByText(/最近寄送紀錄/).click();
    await expect(scheduleArticle.getByText("模擬完成", { exact: true })).toBeVisible();

    const schedule = await prisma.reportSchedule.findFirstOrThrow({ where: { organizationId, name: scheduleName } });
    expect(schedule.stallIds).toContain(primaryStallId);
    const delivery = await prisma.reportDelivery.findFirstOrThrow({ where: { reportScheduleId: schedule.id }, orderBy: { createdAt: "desc" } });
    expect(delivery.status).toBe("SIMULATED");
    expect(delivery.payload).toBeTruthy();

    await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    const unauthorizedCron = await page.request.get("/api/cron/report-deliveries", { headers: { authorization: "Bearer wrong-secret" } });
    expect(unauthorizedCron.status()).toBe(401);
    const cron = await page.request.get("/api/cron/report-deliveries", { headers: { authorization: "Bearer e2e-cron-secret" } });
    expect(cron.ok()).toBe(true);
    expect((await cron.json()).processed).toBe(1);
    expect(await prisma.reportDelivery.count({ where: { reportScheduleId: schedule.id, status: "SIMULATED" } })).toBe(2);
  });
});

async function cleanup() {
  await prisma.stall.updateMany({ where: { id: primaryStallId }, data: { businessStatus: "OPEN", orderingEnabled: true } });
  const schedules = await prisma.reportSchedule.findMany({ where: { organizationId, name: scheduleName }, select: { id: true } });
  const scheduleIds = schedules.map((schedule) => schedule.id);
  if (scheduleIds.length > 0) {
    await prisma.reportDelivery.deleteMany({ where: { reportScheduleId: { in: scheduleIds } } });
    await prisma.reportSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  }
  await prisma.operationalAlert.deleteMany({ where: { organizationId, message: alertMessage } });
  await prisma.operationalAlert.deleteMany({ where: { organizationId, message: { startsWith: paginationAlertPrefix } } });
  await prisma.auditLog.deleteMany({ where: { organizationId, action: { startsWith: paginationAuditPrefix } } });
  await prisma.auditLog.deleteMany({ where: { organizationId, action: { in: ["REPORT_SCHEDULE_CREATED", "REPORT_SCHEDULE_TESTED"] } } });
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=|\/staff\//, { timeout: 30_000 });
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
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
