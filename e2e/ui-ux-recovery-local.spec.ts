import { expect, test } from "@playwright/test";

test.skip(process.env.UI_UX_QA !== "true", "Explicit isolated UI recovery QA only.");
const org = "11111111-1111-4111-8111-111111111111";
const stall = "22222222-2222-4222-8222-222222222222";
test.beforeEach(async ({ page }) => {
  expect(process.env.PLAYWRIGHT_APP_URL).toBe("http://127.0.0.1:3023");
  await page.goto(`/login?next=${encodeURIComponent(`/merchant/catalog?organizationId=${org}`)}`);
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "商家", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/merchant/catalog");
});

test("availability keeps input on 429/500/network failure and prevents duplicate submission", async ({ page }) => {
  const endpoint = `**/api/merchant/stalls/${stall}/products`;
  await page.getByTestId("catalog-management-row").getByRole("button", { name: /設定供應狀態/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "設定供應狀態", exact: true });
  await dialog.getByRole("button", { name: /指定日期恢復/ }).click();
  await dialog.getByLabel("恢復供應日期").fill("2026-10-02");
  for (const status of [429, 500, 0]) {
    let count = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(endpoint, async (route) => {
      count++;
      await held;
      if (status === 0) await route.abort("connectionfailed");
      else await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: `UIUX ${status}，請稍後再試` }) });
    });
    const submit = dialog.getByRole("button", { name: "確認指定日期恢復", exact: true });
    await submit.evaluate((element) => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await expect.poll(() => count).toBe(1);
    await expect(dialog.getByRole("button", { name: "儲存中...", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(dialog.getByLabel("恢復供應日期")).toHaveValue("2026-10-02");
    expect(count).toBe(1);
    await page.unroute(endpoint);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("dashboard cancels older date queries; latest result survives out-of-order completion and offline retry", async ({ page, context }) => {
  const path = `/merchant/dashboard?organizationId=${org}`;
  await page.goto(path);
  const endpoint = "**/api/merchant/dashboard/overview?*";
  const original = await (await page.request.get(`/api/merchant/dashboard/overview?organizationId=${org}&dateFrom=2026-09-23&dateTo=2026-09-23&stallId=${stall}`)).json();
  expect(original.summary).toBeDefined();
  let count = 0;
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let oldSettled!: () => void;
  const oldDone = new Promise<void>((resolve) => { oldSettled = resolve; });
  await page.route(endpoint, async (route) => {
    const first = new URL(route.request().url()).searchParams.get("dateFrom") === yesterday;
    if (first) count++;
    if (first) await held;
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...original, generatedAt: "2026-09-23T05:00:00Z", summary: { ...original.summary, orderCount: first ? 111 : 222 } }) });
    } finally { if (first) oldSettled(); }
  });
  await page.getByRole("button", { name: "昨天", exact: true }).click();
  await expect.poll(() => count).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "本週", exact: true }).click();
  const summary = page.getByTestId("multi-stall-summary-dashboard");
  await expect(summary.getByText("222", { exact: true })).toBeVisible();
  release();
  await oldDone;
  await expect(summary.getByText("111", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("dashboard-data-freshness")).toContainText("Asia/Taipei");
  await page.unroute(endpoint);
  await context.setOffline(true);
  await page.getByRole("button", { name: "重新整理", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(summary.getByText("222", { exact: true })).toBeVisible();
  await context.setOffline(false);
  const response = page.waitForResponse((r) => r.url().includes("/api/merchant/dashboard/overview?") && r.status() === 200);
  await page.getByRole("button", { name: "重新整理", exact: true }).click();
  await response;
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新整理", exact: true })).toBeEnabled();
});
