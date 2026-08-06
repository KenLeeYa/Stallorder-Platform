import { expect, test, type Page } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
}

test("商品管理工具列依裝置寬度維持功能分列且不溢位", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  const toolRow = page.getByTestId("shared-catalog-tools");
  const createRow = page.getByTestId("shared-catalog-create-actions");
  const toolBounds = await toolRow.boundingBox();
  const createBounds = await createRow.boundingBox();
  expect(toolBounds).not.toBeNull();
  expect(createBounds).not.toBeNull();
  expect(createBounds!.y).toBeGreaterThanOrEqual(toolBounds!.y + toolBounds!.height);

  const desktopCreateButtons = await createRow.locator(":scope > button").evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height };
  }));
  expect(desktopCreateButtons).toHaveLength(4);
  expect(new Set(desktopCreateButtons.map(({ top }) => Math.round(top))).size).toBe(1);
  for (const bounds of desktopCreateButtons) expect(bounds.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 375, height: 812 });
  const toolbarControls = page.getByTestId("shared-catalog-actions").locator(":scope > div > button, :scope > div > a, :scope > div > label");
  const mobileBounds = await toolbarControls.evaluateAll((controls) => controls.map((control) => {
    const bounds = control.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, height: bounds.height };
  }));
  expect(mobileBounds).toHaveLength(8);
  for (const bounds of mobileBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(375);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
