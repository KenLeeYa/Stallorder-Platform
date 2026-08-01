import { expect, test } from "@playwright/test";

const demoQrToken = "demo-aming-chicken-qr-2026-rotate-me";
const availableConfig = {
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
};

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
  const sessionRequestIds: string[] = [];
  let releaseInitialFailure!: () => void;
  const initialFailure = new Promise<void>((resolve) => {
    releaseInitialFailure = resolve;
  });

  await page.route("**/api/availability/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(availableConfig),
    });
  });
  await page.route("**/create-order-session", async (route) => {
    sessionAttempts += 1;
    const requestBody = route.request().postDataJSON() as { sessionRequestId?: string };
    sessionRequestIds.push(String(requestBody.sessionRequestId ?? ""));
    if (sessionAttempts === 1) {
      await initialFailure;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "ORDER_CREATE_ERROR" }),
      });
      return;
    }
    if (sessionAttempts === 2) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "SESSION_EXPIRED" }),
      });
      return;
    }
    if (sessionAttempts === 3) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "SCHEDULE_CONTEXT_MISMATCH" }),
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

  const sessionStatus = page.locator("#main-content").getByTestId("qr-session-status");
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "AVAILABLE");
  expect(sessionAttempts).toBe(1);

  releaseInitialFailure();

  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "UNAVAILABLE");
  await expect(page.getByRole("heading", { name: "線上送單暫時停用", exact: true })).toBeVisible();
  await expect(page.locator("main > section").getByText(
    "目前無法建立或查詢訂單，請稍後再試。",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("正在建立安全點餐工作階段...", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "重新檢查", exact: true }).click();

  await expect.poll(() => sessionAttempts).toBe(2);
  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "UNAVAILABLE");
  expect(sessionRequestIds[1]).toBe(sessionRequestIds[0]);

  await page.getByRole("button", { name: "重新檢查", exact: true }).click();

  await expect.poll(() => sessionAttempts).toBe(3);
  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "UNAVAILABLE");
  expect(sessionRequestIds[2]).not.toBe(sessionRequestIds[1]);

  await page.getByRole("button", { name: "重新檢查", exact: true }).click();

  await expect.poll(() => sessionAttempts).toBe(4);
  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "AVAILABLE");
  await expect(page.getByRole("heading", { name: "線上送單暫時停用", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "增加 香酥雞排" })).toBeEnabled();
  expect(sessionRequestIds[3]).not.toBe(sessionRequestIds[2]);
});

test("後端 target 切換時忽略舊工作階段的晚到失敗", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let availabilityRequests = 0;
  let sessionAttempts = 0;
  const sessionRequestIds: string[] = [];
  let releaseInitialResponse!: () => void;
  let markInitialResponseSent!: () => void;
  const initialResponse = new Promise<void>((resolve) => {
    releaseInitialResponse = resolve;
  });
  const initialResponseSent = new Promise<void>((resolve) => {
    markInitialResponseSent = resolve;
  });

  await page.route("**/api/availability/config", async (route) => {
    availabilityRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(availabilityRequests === 1
        ? availableConfig
        : { ...availableConfig, activeBackend: "DR", promotionEpoch: 2 }),
    });
  });
  await page.route("**/create-order-session", async (route) => {
    sessionAttempts += 1;
    const requestBody = route.request().postDataJSON() as { sessionRequestId?: string };
    sessionRequestIds.push(String(requestBody.sessionRequestId ?? ""));
    if (sessionAttempts === 1) {
      await initialResponse;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "ORDER_CREATE_ERROR" }),
      });
      markInitialResponseSent();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        orderSessionToken: `session_${"d".repeat(48)}`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
  });

  await page.goto(`/q/${demoQrToken}`);

  const sessionStatus = page.locator("#main-content").getByTestId("qr-session-status");
  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "AVAILABLE");
  expect(sessionAttempts).toBe(1);

  await page.getByRole("button", { name: "點餐語言", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();

  await expect.poll(() => sessionAttempts).toBe(2);
  await expect(sessionStatus).toContainText(/^Time remaining /);
  expect(sessionRequestIds[1]).not.toBe(sessionRequestIds[0]);

  releaseInitialResponse();
  await initialResponseSent;
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  await expect(sessionStatus).toHaveAttribute("data-ordering-availability", "AVAILABLE");
  await expect(sessionStatus).toContainText(/^Time remaining /);
  await expect(page.getByRole("heading", {
    name: "Online ordering is temporarily unavailable",
    exact: true,
  })).toHaveCount(0);
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
