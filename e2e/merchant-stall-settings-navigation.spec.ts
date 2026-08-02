import { expect, test } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test.use({ viewport: { width: 390, height: 844 } });

test("手機版攤位設定以跳轉頁面呈現", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
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
  await expect(page.getByRole("link", { name: "KDS 工作站", exact: true }))
    .toHaveAttribute("href", `/merchant/stalls/${stallId}/kitchen/stations`);
  await expect(page.getByRole("link", { name: "KDS 設定", exact: true }))
    .toHaveAttribute("href", `/merchant/stalls/${stallId}/kitchen/settings`);

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

  const organizationLinks = [
    ["商家資料", "organization"],
    ["翻譯完整度", "localization"],
    ["市集活動", "events"],
    ["團隊與權限", "team"],
    ["排程寄送", "report-schedules"],
  ] as const;

  for (const [label, route] of organizationLinks) {
    await page.goto(`/merchant/stalls/${stallId}`);
    const link = page.getByRole("link", { name: label, exact: true });
    const destination = `/merchant/${route}?organizationId=${organizationId}&stallId=${stallId}`;
    await expect(link).toHaveAttribute("href", destination);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/merchant/${route}\\?organizationId=${organizationId}&stallId=${stallId}$`));
    const backLink = page.getByRole("link", { name: "返回攤位設定", exact: true });
    await expect(backLink).toHaveAttribute("href", `/merchant/stalls/${stallId}`);
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}$`));
  }

  await page.goto(`/merchant/localization?organizationId=${organizationId}&stallId=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("link", { name: "返回攤位設定", exact: true })).toHaveCount(0);

  await page.goto("/merchant/aming-chicken");
  const sharedCatalogLink = page.getByRole("link", { name: "管理共用商品主檔", exact: true });
  await expect(sharedCatalogLink).toHaveAttribute(
    "href",
    `/merchant/catalog?organizationId=${organizationId}&stallId=${stallId}&source=stall-products`,
  );
  await sharedCatalogLink.click();
  await expect(page.getByRole("link", { name: "返回商品供應", exact: true }))
    .toHaveAttribute("href", "/merchant/aming-chicken");

  await page.goto(`/merchant/localization?organizationId=${organizationId}&stallId=${stallId}`);
  const catalogTranslationLink = page.getByRole("link", { name: "前往編輯翻譯", exact: true });
  await expect(catalogTranslationLink).toHaveAttribute(
    "href",
    `/merchant/catalog?organizationId=${organizationId}&stallId=${stallId}&source=localization`,
  );
  await catalogTranslationLink.click();
  await expect(page.getByRole("link", { name: "返回翻譯完整度", exact: true }))
    .toHaveAttribute("href", `/merchant/localization?organizationId=${organizationId}&stallId=${stallId}`);

  await page.goto(`/merchant/stalls/${stallId}/settings/modules?source=staff#discount-options`);
  await expect(page.getByRole("link", { name: "返回店員訂單", exact: true }))
    .toHaveAttribute("href", "/staff/aming-chicken");

  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mobile-stall-settings.png"), fullPage: true });
});
