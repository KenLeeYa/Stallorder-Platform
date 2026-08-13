import { expect, test, type Page } from "@playwright/test";
import { gotoLocalPath } from "./local-navigation";

const routes = [
  "/merchant/dashboard",
  "/merchant/stalls?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/modules",
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/products",
  "/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/operations",
  "/merchant/reports/overview?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/products?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/payments?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/stalls?organizationId=11111111-1111-4111-8111-111111111111",
  "/merchant/reports/cash-shifts?organizationId=11111111-1111-4111-8111-111111111111",
  "/staff/aming-chicken",
  "/staff/aming-chicken/cash",
  "/staff/aming-chicken/floor",
  "/kitchen?stall=aming-chicken",
];

const publicRoutes = [
  "/store/aming-01?view=menu",
  "/q/demo-aming-chicken-qr-2026-rotate-me",
  "/store/aming-01?view=pickup",
  "/store/aming-01?view=delivery",
];

const canonicalRoutePaths: Record<string, string> = {
  "/merchant/stalls/22222222-2222-4222-8222-222222222222/products": "/merchant/aming-chicken",
};

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/, { timeout: 30_000 });
}

test("核心營運頁面在手機、平板與桌面不產生全頁水平溢位", async ({ page }) => {
  test.setTimeout(240_000);
  const viewports = [
    { name: "compact-mobile", width: 320, height: 568 },
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];

  await page.setViewportSize(viewports[0]);
  await login(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await gotoLocalPath(page, route, canonicalRoutePaths[route] ?? route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        `Unexpected page-level horizontal overflow at ${route} (${viewport.name})`,
      ).toBe(true);
    }
  }
});

test("舊公開連結在 HTTP 層導向攤位代碼入口", async ({ request }) => {
  for (const [legacyPath, view] of [
    ["/menu/aming-chicken", "menu"],
    ["/s/aming-chicken", "pickup"],
    ["/delivery/aming-chicken", "delivery"],
  ] as const) {
    const response = await request.get(legacyPath, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const location = response.headers().location;
    expect(location).toBe(`/store/aming-01?view=${view}`);
  }
});

for (const viewport of [
  { name: "compact-mobile", width: 320, height: 568 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} 公開菜單與點餐入口不產生全頁水平溢位`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of publicRoutes) {
      await gotoLocalPath(page, route, canonicalRoutePaths[route] ?? route);
      await expect(page.locator("body")).toBeVisible();
      await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
        `Unexpected page-level horizontal overflow at ${route} (${viewport.name})`,
      ).toBe(true);
      await expect(page.getByRole("main")).toBeVisible();
    }
  });
}
