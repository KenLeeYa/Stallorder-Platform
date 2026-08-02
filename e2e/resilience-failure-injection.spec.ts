import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const flagReason = "P8 E2E local Edge circuit failure injection";
const demoQrToken = "demo-aming-chicken-qr-2026-rotate-me";

test.describe("P8 生產韌性故障注入", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await removeTemporaryFlag();
    const [flag, owner] = await Promise.all([
      prisma.resilienceFeatureFlag.findUniqueOrThrow({
        where: { code: "DUAL_ORDER_INTAKE_ENABLED" },
        select: { id: true },
      }),
      prisma.profile.findUniqueOrThrow({
        where: { email: "owner@stallorder.test" },
        select: { id: true },
      }),
    ]);
    await prisma.resilienceFeatureFlagOverride.create({
      data: {
        flagId: flag.id,
        scopeType: "GLOBAL",
        enabled: true,
        reason: flagReason,
        createdByProfileId: owner.id,
        updatedByProfileId: owner.id,
      },
    });
  });

  test.afterAll(async () => {
    await removeTemporaryFlag();
    await prisma.$disconnect();
  });

  test("Supabase Edge 回傳 503 時以同一請求識別轉入 Circuit B", async ({ page }) => {
    await page.route((url) => [
      "/functions/v1/create-order-session",
      "/api/public-order/create-order-session",
    ].includes(url.pathname), async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "ORDER_CREATE_ERROR",
          error: "Injected local Edge failure",
        }),
      });
    });
    const fallbackResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/public/order-session"
      && response.request().method() === "POST"
    ));

    await page.goto(`/q/${demoQrToken}`);
    const response = await fallbackResponse;

    expect(response.status()).toBe(201);
    expect(response.headers()["x-order-circuit"]).toBe("B");
    await expect(page.getByRole("button", { name: "增加 香酥雞排" })).toBeEnabled();
    await expect(page.getByText(/點餐時間剩餘 \d{1,2}:\d{2}/)).toBeVisible();
  });

  test("SSE 與 Realtime 同時失效時顯示 5 秒輪詢並持續抓取訂單", async ({ page }) => {
    let orderListRequests = 0;
    await page.route("**/api/stalls/*/orders/stream", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected local SSE failure" }),
      });
    });
    await page.routeWebSocket("**/realtime/v1/**", (socket) => socket.close());
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "GET"
        && url.pathname === "/api/stalls/aming-chicken/orders"
      ) {
        orderListRequests += 1;
      }
    });

    await login(page, "staff@stallorder.test", /\/staff\/aming-chicken/);

    await expect(page.locator(
      '[title="SSE 與 Realtime 未就緒，已啟用 5 秒輪詢"]',
    )).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => orderListRequests, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  });
});

async function removeTemporaryFlag() {
  const flag = await prisma.resilienceFeatureFlag.findUnique({
    where: { code: "DUAL_ORDER_INTAKE_ENABLED" },
    select: { id: true },
  });
  if (!flag) return;
  await prisma.resilienceFeatureFlagOverride.deleteMany({
    where: { flagId: flag.id, reason: flagReason },
  });
}

async function login(page: Page, email: string, expectedUrl: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(expectedUrl, { timeout: 30_000 });
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
    process.env[match[1]] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }
}
