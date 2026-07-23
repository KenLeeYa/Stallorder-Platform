import { expect, test } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test.use({ viewport: { width: 390, height: 844 } });

test("手機版攤位設定以跳轉頁面呈現", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 30_000 });

  await page.goto(`/merchant/stalls/${stallId}`);
  const [brandBox, organizationBox, scopeBox] = await Promise.all([
    page.getByRole("link", { name: "攤點通", exact: true }).boundingBox(),
    page.getByLabel("選擇組織").boundingBox(),
    page.getByLabel("選擇攤位範圍").boundingBox(),
  ]);
  expect(brandBox).not.toBeNull();
  expect(organizationBox).not.toBeNull();
  expect(scopeBox).not.toBeNull();
  expect(organizationBox!.y).toBeGreaterThan(brandBox!.y + brandBox!.height);
  expect(Math.abs(organizationBox!.y - scopeBox!.y)).toBeLessThanOrEqual(1);
  expect(scopeBox!.x).toBeGreaterThan(organizationBox!.x);
  expect(Math.abs(organizationBox!.width - scopeBox!.width)).toBeLessThanOrEqual(1);

  for (const heading of ["攤位設定", "營運工具", "組織管理"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "現金交班報表", exact: true })).toHaveCount(0);

  const sectionLinks = [
    ["基本資料", "basic"],
    ["營運狀態", "operations"],
    ["營業時間", "business-hours"],
    ["營運模組與內用桌位", "modules"],
    ["多攤位範本", "templates"],
    ["攤位成員", "members"],
  ] as const;

  for (const [label, section] of sectionLinks) {
    await page.goto(`/merchant/stalls/${stallId}`);
    const link = page.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", `/merchant/stalls/${stallId}/settings/${section}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/settings/${section}$`));
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "返回攤位設定", exact: true })).toBeVisible();
  }

  await page.goto(`/merchant/stalls/${stallId}`);
  await expect(page.getByRole("link", { name: "翻譯完整度", exact: true }))
    .toHaveAttribute("href", `/merchant/localization?organizationId=${organizationId}`);
  await expect(page.getByRole("link", { name: "市集活動", exact: true }))
    .toHaveAttribute("href", `/merchant/events?organizationId=${organizationId}`);
  await expect(page.getByRole("link", { name: "團隊與權限", exact: true }))
    .toHaveAttribute("href", `/merchant/team?organizationId=${organizationId}`);
  await expect(page.getByRole("link", { name: "排程寄送", exact: true }))
    .toHaveAttribute("href", `/merchant/report-schedules?organizationId=${organizationId}`);

  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-stall-settings.png"), fullPage: true });
});
