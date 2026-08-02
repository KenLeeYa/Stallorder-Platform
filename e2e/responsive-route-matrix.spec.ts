import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/merchant/dashboard",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/products",
  "/merchant/operations",
  "/staff/aming-chicken",
  "/kitchen?stall=aming-chicken",
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 30_000 });
}

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`${viewport.name} 核心營運頁面不產生全頁水平溢位`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page);

    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `Unexpected page-level horizontal overflow at ${route} (${viewport.name})`,
      ).toBe(true);
    }
  });
}
