import { expect, test } from "@playwright/test";

const ownerEmail = "owner@stallorder.test";
const password = "StallOrderDemo!2026";

test("示範 Owner 可登入並建立有效 session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(ownerEmail);
  await page.getByLabel("密碼").fill(password);

  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));

  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  await expect(page.getByText("多攤位營運總覽", { exact: true })).toBeVisible();
});
