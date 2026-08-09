import { expect, test, type Page } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("稽核紀錄以繁體中文顯示並在詳情保留原始代碼", async ({ page }) => {
  await login(page);
  await page.goto(`/merchant/operations?organizationId=${organizationId}&auditQuery=LOGIN_SUCCESS`);

  const auditSection = page.locator('section[aria-labelledby="audit-title"]');
  const loginRecord = auditSection.locator("details").filter({ hasText: "帳密登入成功" }).first();
  await expect(loginRecord).toBeVisible();
  await loginRecord.locator("summary").click();
  await expect(loginRecord.getByText("登入與驗證", { exact: true })).toBeVisible();
  await expect(loginRecord.getByText("LOGIN_SUCCESS", { exact: true })).toBeVisible();
  await expect(loginRecord.getByText("AUTH", { exact: true })).toBeVisible();
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
}
