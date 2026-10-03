import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block", trace: "off", video: "off" });
test.beforeEach(({ baseURL }) => {
  const target = new URL(baseURL ?? "");
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("LOCAL_ISOLATED_QA_ONLY");
});

test("MINI 未設定時提供可理解提示，沒有登入迴圈或外部請求", async ({ page, baseURL }) => {
  const errors: string[] = [];
  const external: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).origin !== origin) external.push(new URL(request.url()).origin); });
  const response = await page.goto("/mini");
  await expect(page).toHaveURL(`${origin}/mini`);
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

test("MINI 未啟用時既有商戶帳密登入仍可進入受保護頁", async ({ page }) => {
  const next = "/merchant/dashboard?organizationId=11111111-1111-4111-8111-111111111111";
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const origin = new URL(page.url()).origin;
  const onDashboard = (url: URL) => url.origin === origin && url.pathname === "/merchant/dashboard"
    && url.searchParams.get("organizationId") === "11111111-1111-4111-8111-111111111111";
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "使用帳密登入", exact: true });
  await dialog.getByLabel("電子郵件", { exact: true }).fill("owner@stallorder.test");
  await dialog.getByLabel("密碼", { exact: true }).fill("StallOrderDemo!2026");
  const login = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "登入", exact: true }).click();
  expect((await login).status()).toBe(200);
  await expect(page).toHaveURL(onDashboard);
  await expect(page.getByRole("heading", { name: "StallOrder 示範商戶", exact: true })).toBeVisible();
  const mini = await page.request.post("/api/mini/auth/challenge", { headers: { origin }, data: {} });
  expect(mini.status()).toBe(503);
  expect(mini.headers()["cache-control"]).toContain("no-store");
  expect(await mini.json()).toEqual({ error: "LINE 登入暫時無法使用，請稍後重試。" });
  // Use the browser's cookie handling for production Secure cookies on loopback.
  expect(await page.evaluate(async () => (await fetch("/api/auth/me", { cache: "no-store" })).status)).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(onDashboard);
  await expect(page.getByRole("heading", { name: "StallOrder 示範商戶", exact: true })).toBeVisible();
});
