import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("健康資訊實際角色、撤銷與直接路徑邊界", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const result = await promisify(execFile)(process.execPath, ["scripts/qa-health-access.mjs"], {
    env: { ...process.env, HEALTH_QA_BASE_URL: baseURL, HEALTH_QA_REPORT: "" },
  });
  const report = JSON.parse(result.stdout) as { cases: number; results: { passed: boolean }[] };
  expect(report.cases).toBe(51);
  expect(report.results.every((item) => item.passed)).toBe(true);
});

test("平台管理者從登入進入中文健康看板並重新檢查", async ({ page }) => {
  await page.goto("/login?next=%2Fadmin%2Fhealth");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("platform.admin@stallorder.test");
  await page.getByLabel("密碼", { exact: true }).fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/health$/);
  await expect(page.getByRole("heading", { name: "正式站健康看板", exact: true })).toBeVisible();
  const checks = page.getByRole("region", { name: "各項服務檢查", exact: true });
  await expect(checks.locator("article")).toHaveCount(13);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await expect(page.getByRole("link", { name: "重新檢查", exact: true })).toBeVisible();
  }
  const [reload] = await Promise.all([
    page.waitForResponse((response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/admin/health"),
    page.getByRole("link", { name: "重新檢查", exact: true }).click(),
  ]);
  expect(reload.status()).toBe(200);
  await expect(page.getByText(/最後檢查：/)).toBeVisible();
  const health = await page.request.get("/api/health", { headers: { accept: "application/json" } });
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toContain("no-store");
});
