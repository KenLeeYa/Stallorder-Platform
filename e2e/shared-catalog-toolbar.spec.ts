import { expect, test, type Page } from "@playwright/test";
import { openSharedCatalogManagement } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "使用電子郵件與密碼登入", exact: true })
    .click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:merchant\/dashboard\?organizationId=|select-organization)/);
  if (new URL(page.url()).pathname === "/select-organization") {
    await page.locator(`a[href="/merchant/dashboard?organizationId=${organizationId}"]`).click();
  }
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
}

test("商品管理工具列依裝置寬度維持功能分列且不溢位", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page);
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await openSharedCatalogManagement(page);

  const catalogRegion = page.getByRole("region", { name: "共用商品" });
  await expect(catalogRegion).toHaveCount(1);
  await expect(catalogRegion).toBeVisible();
  const toolRow = catalogRegion.getByTestId("shared-catalog-tools");
  const createRow = catalogRegion.getByTestId("shared-catalog-create-actions");
  const toolBounds = await toolRow.boundingBox();
  const createBounds = await createRow.boundingBox();
  expect(toolBounds).not.toBeNull();
  expect(createBounds).not.toBeNull();
  expect(createBounds!.y === toolBounds!.y
    ? createBounds!.x >= toolBounds!.x + toolBounds!.width
    : createBounds!.y >= toolBounds!.y + toolBounds!.height).toBe(true);
  await expect(createRow.locator(":scope > *").last()).toHaveAttribute(
    "data-testid",
    "catalog-versions-action",
  );

  const desktopCreateButtons = await createRow
    .locator(":scope > button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        return { top: bounds.top, height: bounds.height };
      }),
    );
  expect(desktopCreateButtons).toHaveLength(5);
  const sortAction = createRow.getByRole("button", { name: "分類與群組排序", exact: true });
  await expect(sortAction).toBeVisible();
  expect(
    new Set(desktopCreateButtons.map(({ top }) => Math.round(top))).size,
  ).toBe(1);
  for (const bounds of desktopCreateButtons)
    expect(bounds.height).toBeGreaterThanOrEqual(44);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(sortAction).toBeHidden();
  const actions = catalogRegion.getByTestId("shared-catalog-action-scroller");
  const toolbarControls = actions.locator(
    ":scope > div > button:visible, :scope > div > a:visible, :scope > div > label:visible",
  );
  const mobileBounds = await toolbarControls.evaluateAll((controls) =>
    controls.map((control) => {
      const bounds = control.getBoundingClientRect();
      return { top: bounds.top, height: bounds.height };
    }),
  );
  expect(mobileBounds).toHaveLength(8);
  expect(new Set(mobileBounds.map(({ top }) => Math.round(top))).size).toBe(2);
  for (const bounds of mobileBounds) {
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  const scrollLayout = await actions.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(scrollLayout.clientWidth).toBeLessThanOrEqual(375);
  expect(scrollLayout.scrollWidth).toBeLessThanOrEqual(scrollLayout.clientWidth + 1);
  const positions = await toolbarControls.evaluateAll(controls => controls.map(control => {
    const bounds = control.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  }));
  for (const [index, bounds] of positions.entries()) {
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(376);
    for (const other of positions.slice(index + 1)) {
      expect(bounds.right <= other.left || other.right <= bounds.left
        || bounds.bottom <= other.top || other.bottom <= bounds.top).toBe(true);
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
