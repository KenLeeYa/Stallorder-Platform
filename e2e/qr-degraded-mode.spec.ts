import { expect, test } from "@playwright/test";

const demoQrToken = "demo-aming-chicken-qr-2026-rotate-me";

test("後端降級時保留 QR 菜單並停用所有送單操作", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/availability/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "DEGRADED_SAFE",
        activeBackend: "PRIMARY",
        promotionEpoch: 1,
        orderIntake: "DUAL",
        qrOrdering: "DEGRADED",
        staffOnline: "DEGRADED",
        offlinePos: "AVAILABLE",
        linePay: "UNAVAILABLE",
        jkoPay: "UNAVAILABLE",
        updatedAt: "2026-07-29T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/create-order-session", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        code: "QR_ORDERING_DEGRADED",
        error: "目前線上送單暫時停用，請至攤位櫃台點餐。",
      }),
    });
  });

  await page.goto(`/q/${demoQrToken}`);

  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "線上送單暫時停用", exact: true })).toBeVisible();
  await expect(page.getByText("您仍可查看菜單，請至攤位櫃台點餐。", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "香酥雞排" })).toBeVisible();
  await expect(page.getByRole("button", { name: "增加 香酥雞排" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toHaveCount(0);
  await expect(page.locator("iframe[title*='Turnstile']")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("安全工作階段失敗時顯示錯誤並可重新建立", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sessionAttempts = 0;
  let markAvailabilityReady!: () => void;
  const availabilityReady = new Promise<void>((resolve) => {
    markAvailabilityReady = resolve;
  });

  await page.route("**/api/availability/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "NORMAL_PRIMARY",
        activeBackend: "PRIMARY",
        promotionEpoch: 1,
        orderIntake: "EDGE_PRIMARY",
        qrOrdering: "AVAILABLE",
        staffOnline: "AVAILABLE",
        offlinePos: "AVAILABLE",
        linePay: "AVAILABLE",
        jkoPay: "AVAILABLE",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    });
    markAvailabilityReady();
  });
  await page.route("**/create-order-session", async (route) => {
    sessionAttempts += 1;
    if (sessionAttempts === 1) {
      await availabilityReady;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "ORDER_CREATE_ERROR" }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        orderSessionToken: `session_${"s".repeat(48)}`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
  });

  await page.goto(`/q/${demoQrToken}`);

  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "線上送單暫時停用", exact: true })).toBeVisible();
  await expect(page.locator("main > section").getByText(
    "目前無法建立或查詢訂單，請稍後再試。",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("正在建立安全點餐工作階段...", { exact: true })).toHaveCount(0);
  expect(sessionAttempts).toBe(1);

  await page.getByRole("button", { name: "重新檢查", exact: true }).click();

  await expect.poll(() => sessionAttempts).toBe(2);
  await expect(page.getByRole("heading", { name: "線上送單暫時停用", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "增加 香酥雞排" })).toBeEnabled();
});

test("已快取的 QR 菜單在網路中斷後維持唯讀", async ({ context, page }) => {
  test.skip(
    process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true",
    "Service Worker 導覽快取只在 production-mode E2E 驗證。",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/q/${demoQrToken}`);
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "線上送單暫時停用", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "增加 香酥雞排" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});
