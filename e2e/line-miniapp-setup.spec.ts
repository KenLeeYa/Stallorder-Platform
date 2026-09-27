import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block", trace: "off", video: "off" });
test.beforeEach(() => {
  if (process.env.PLAYWRIGHT_APP_URL !== "http://127.0.0.1:3024" || process.env.LINE_MINIAPP_UI_QA !== "true") throw new Error("LOCAL_ISOLATED_QA_ONLY");
});

test("MINI 未設定時提供可理解提示，沒有登入迴圈或外部請求", async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).hostname !== "127.0.0.1") external.push(new URL(request.url()).origin); });
  const response = await page.goto("/mini");
  await expect(page.getByRole("heading", { name: "LINE 點餐" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("店家正在準備 LINE 連線設定");
  await expect(page.getByRole("button", { name: /LINE.*登入/ })).toHaveCount(0);
  // Next dev overrides document Cache-Control with no-cache, must-revalidate.
  // The API must still return no-store; release document headers need live readback.
  expect(response?.headers()["cache-control"]).toMatch(/no-cache|no-store/);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["content-security-policy"]).toContain("https://api.line.me");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("新增登入流程後既有商戶快速登入仍可進入受保護頁", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "商家", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\//);
  await expect(page.getByRole("heading", { name: "StallOrder 示範商戶", exact: true })).toBeVisible();
  const mini = await page.request.post("/api/mini/auth/challenge", { headers: { origin: "http://127.0.0.1:3024" }, data: {} });
  expect(mini.status()).toBe(503);
  expect(await mini.json()).toEqual({ error: "LINE 登入暫時無法使用，請稍後重試。" });
});
