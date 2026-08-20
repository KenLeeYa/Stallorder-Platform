import { expect, test } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test.use({ viewport: { width: 375, height: 812 } });

test("手機版攤位設定以跳轉頁面呈現", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const overviewPath = `/merchant/stalls/${stallId}`;
  const sectionLinks = [
    ["基本資料", "basic"],
    ["營運狀態", "operations"],
    ["營業時間", "business-hours"],
    ["營運模組與內用桌位", "modules"],
    ["安全與訂單限制", "order-limits"],
    ["多攤位範本", "templates"],
    ["攤位成員", "members"],
  ] as const;
  const staticSectionScopes: Record<string, string> = {
    basic: "stall-basic",
    operations: "stall-operations",
    "business-hours": "business-hours",
    templates: "stall-template",
    members: "stall-team",
  };
  const organizationLinks = [
    ["商家資料", "organization"],
    ["翻譯完整度", "localization"],
    ["市集活動", "events"],
    ["團隊與權限", "team"],
    ["排程寄送", "report-schedules"],
  ] as const;

  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/merchant/dashboard\\?organizationId=${organizationId}$`),
    { timeout: 30_000 },
  );

  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER !== "true") {
    const destinationPaths = [
      ...sectionLinks.map(([, section]) => `/merchant/stalls/${stallId}/settings/${section}`),
      ...organizationLinks.map(([, route]) => (
        `/merchant/${route}?organizationId=${organizationId}&stallId=${stallId}`
      )),
    ];
    for (const destinationPath of destinationPaths) {
      const warmupResponse = await page.context().request.get(destinationPath);
      expect(warmupResponse.status()).toBe(200);
      await warmupResponse.dispose();
    }
  }
  await page.goto(overviewPath);
  await expect(page.getByLabel("應用程式狀態")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "商戶功能" })).toBeVisible();
  const expandMerchantOptions = page.getByRole("button", { name: "展開商戶選項" });
  await expect(expandMerchantOptions).toHaveAttribute("aria-expanded", "false");
  await expandMerchantOptions.click();
  await expect(page.getByRole("button", { name: "收合商戶選項" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: "攤點通", exact: true })).toHaveAttribute(
    "href",
    `/merchant/dashboard?organizationId=${organizationId}`,
  );
  await expect(page.getByLabel("選擇商家")).toHaveCount(0);
  await expect(page.getByLabel("選擇攤位")).toHaveCount(0);
  const stallShortcut = page.getByRole("link", { name: "前往攤位 阿明鹽酥雞", exact: true });
  await expect(stallShortcut).toHaveAttribute("href", "/merchant/aming-chicken");
  const workMode = page.getByLabel("切換工作模式");
  const [stallShortcutBox, workModeBox] = await Promise.all([
    stallShortcut.boundingBox(),
    workMode.boundingBox(),
  ]);
  expect(stallShortcutBox).not.toBeNull();
  expect(workModeBox).not.toBeNull();
  expect(stallShortcutBox!.x).toBeGreaterThan(workModeBox!.x);
  expect(Math.abs(stallShortcutBox!.y - workModeBox!.y)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "收合商戶選項" }).click();
  await expect(stallShortcut).toBeHidden();
  await expect(workMode).toBeHidden();
  await expect(page.getByRole("navigation", { name: "商戶功能" })).toBeVisible();
  await expect(page.getByLabel("應用程式狀態")).toBeVisible();
  await page.getByRole("button", { name: "展開商戶選項" }).click();

  for (const heading of ["攤位設定", "營運工具", "組織管理"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "現金交班報表", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "KDS 工作站", exact: true }))
    .toHaveAttribute("href", `/merchant/stalls/${stallId}/kitchen/stations`);
  await expect(page.getByRole("link", { name: "KDS 設定", exact: true }))
    .toHaveAttribute("href", `/merchant/stalls/${stallId}/kitchen/settings`);

  for (const [label, section] of sectionLinks) {
    await page.goto(overviewPath);
    const link = page.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", `/merchant/stalls/${stallId}/settings/${section}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/settings/${section}$`));
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "返回攤位設定", exact: true })).toBeVisible();
    const staticScope = staticSectionScopes[section];
    if (staticScope) {
      await expect(page.locator(`section[data-settings-scope="${staticScope}"]`)).toHaveCount(1);
    }
    await expect(page.locator("details[data-settings-scope]")).toHaveCount(section === "modules" ? 1 : 0);
    await expect(page.getByTestId("stall-modules-toggle-all")).toHaveCount(section === "modules" ? 1 : 0);
    const hasSectionOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(hasSectionOverflow, `${label} 不應產生手機版水平溢位`).toBe(false);
  }

  for (const [label, route] of organizationLinks) {
    await page.goto(overviewPath);
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
