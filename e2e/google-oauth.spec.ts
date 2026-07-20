import { expect, test } from "@playwright/test";

test("Google 登入按鈕會顯示並完成受控 OAuth 流程", async ({ page }) => {
  await page.goto("/login");
  const googleLogin = page.getByRole("button", { name: "使用 Google 帳號登入" });
  await expect(googleLogin).toBeVisible();

  await googleLogin.click();

  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  await expect(page.getByText("多攤位營運總覽", { exact: true })).toBeVisible();
});

test("OAuth callback 缺少 code 時安全返回登入頁", async ({ page }) => {
  await page.goto("/auth/callback");

  await expect(page).toHaveURL(/\/login\?oauthError=callback-failed$/);
  await expect(page.getByText("Google 登入驗證失敗，請重新嘗試。", { exact: true })).toBeVisible();
});

test("OAuth next 不接受外部網址", async ({ page }) => {
  await page.goto("/auth/google?next=https%3A%2F%2Fevil.example%2Fsteal");

  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  expect(new URL(page.url()).origin).toBe("http://localhost:3001");
});

test("未登入使用者無法直接進入商戶頁", async ({ page }) => {
  await page.goto("/merchant/dashboard");

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("沒有成員資格的 Google 使用者只能進入 onboarding", async ({ page }) => {
  await page.goto("/auth/google?next=%2Fonboarding");

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "商戶申請與開店設定" })).toBeVisible();
});
