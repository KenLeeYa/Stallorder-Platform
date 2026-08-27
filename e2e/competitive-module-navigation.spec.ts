import { expect, test, type Page } from "@playwright/test";
import { gotoLocalPath } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/u, { timeout: 30_000 });
}

test("已啟用的庫存、成長與菜單版本可由商家介面開啟", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organizationId}`);
  const mobileNavigation = page.getByTestId("merchant-function-navigation-mobile");
  await expect(mobileNavigation.getByTitle("庫存與配方")).toBeVisible();
  await expect(mobileNavigation.getByTitle("會員與成長")).toBeVisible();

  await gotoLocalPath(page, `/merchant/supply?organizationId=${organizationId}`);
  await expect(page.getByRole("heading", { name: /Supply Lite 原料與庫存/u })).toBeVisible();

  await gotoLocalPath(page, `/merchant/growth?organizationId=${organizationId}`);
  await expect(page.getByRole("heading", { name: "會員與成長", exact: true })).toBeVisible();

  await gotoLocalPath(page, `/merchant/catalog?organizationId=${organizationId}`);
  const versionsAction = page.getByTestId("catalog-versions-action");
  await expect(versionsAction).toBeVisible();
  await versionsAction.click();
  await expect(page).toHaveURL(/\/merchant\/catalog\/versions\?organizationId=/u);
  await expect(page.getByRole("heading", { name: "菜單版本與發布", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
});
