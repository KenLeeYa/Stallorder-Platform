import { expect, test } from "@playwright/test";
import { catalogCsvHeaders } from "../src/lib/catalog-csv";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test("商戶可管理營運模組與 QR 語系，並檢視其他營運設定", async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard/, { timeout: 30_000 });

  await page.goto(`/merchant/stalls/${stallId}`);
  for (const title of ["攤位設定", "營運工具", "組織管理"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  for (const label of [
    "基本資料",
    "營運狀態",
    "營業時間",
    "營運模組與內用桌位",
    "多攤位範本",
    "攤位成員",
    "CDS 取餐顯示",
    "產能與等候時間",
    "常用地點",
    "出攤行程",
    "LINE 通知",
    "翻譯完整度",
    "市集活動",
    "團隊與權限",
    "排程寄送",
  ]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "現金交班報表", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "基本資料", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/settings/basic$`));
  await expect(page.getByRole("heading", { name: "基本資料", exact: true })).toBeVisible();
  const phoneInput = page.getByLabel("電話", { exact: true });
  const originalPhone = await phoneInput.inputValue();
  await phoneInput.fill(`${originalPhone}0`);
  await phoneInput.fill(originalPhone);

  const basicSaveResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "儲存基本資料", exact: true }).click();
  const basicResponse = await basicSaveResponse;
  expect(basicResponse.status()).toBe(200);
  expect(Object.keys(basicResponse.request().postDataJSON()).sort()).toEqual([
    "operation", "name", "code", "description", "address", "phone", "timezone", "currency",
  ].sort());
  expect(basicResponse.request().postDataJSON().operation).toBe("UPDATE_BASIC");
  await expect(page.getByText("基本資料已更新。", { exact: true })).toBeVisible();

  await page.goto(`/merchant/stalls/${stallId}/settings/operations`);
  await expect(page.getByRole("heading", { name: "營運狀態", exact: true })).toBeVisible();
  const operationsSaveResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/merchant/stalls/${stallId}`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "儲存營運狀態", exact: true }).click();
  const operationsResponse = await operationsSaveResponse;
  expect(operationsResponse.status()).toBe(200);
  expect(Object.keys(operationsResponse.request().postDataJSON()).sort()).toEqual([
    "operation", "businessStatus", "orderingEnabled", "isActive",
  ].sort());
  expect(operationsResponse.request().postDataJSON().operation).toBe("UPDATE_OPERATIONS");
  await expect(page.getByText("營運狀態已更新。", { exact: true })).toBeVisible();

  await page.goto(`/merchant/stalls/${stallId}/settings/modules`);
  await expect(page.getByRole("heading", { name: "營運模組與內用桌位", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: /內用桌位/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: /訂單列印/ })).toHaveAttribute("aria-checked", "true");
  for (const moduleName of ["內用桌位", "線上外送", "訂單列印", "多元付款", "結帳折扣"]) {
    await expect(page.getByRole("switch", { name: new RegExp(moduleName) }).locator("svg")).toHaveCount(1);
  }
  await page.locator("[data-module-switch-grid]").screenshot({ path: testInfo.outputPath("module-switch-icons.png") });
  const localeSection = page.locator('details[aria-label="QR 點餐語系"]');
  if (!(await localeSection.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await localeSection.locator("summary").click();
  }
  const traditionalChineseSwitch = localeSection.getByRole("switch", { name: /繁體中文/ });
  const japaneseSwitch = localeSection.getByRole("switch", { name: /日文/ });
  for (const [locale, flagPath] of Object.entries({ "zh-TW": "/flags/tw.svg", en: "/flags/us.svg", ja: "/flags/jp.svg", ko: "/flags/kr.svg", vi: "/flags/vn.svg", th: "/flags/th.svg" })) {
    const flag = localeSection.locator(`[data-locale-flag="${locale}"]`);
    await expect(flag).toBeVisible();
    await expect(flag).toHaveAttribute("src", new RegExp(flagPath.replace("/", "\\/")));
  }
  await localeSection.locator("[data-locale-switch-grid]").screenshot({ path: testInfo.outputPath("locale-flags.png") });
  await expect(traditionalChineseSwitch).toBeDisabled();
  await expect(traditionalChineseSwitch).toHaveAttribute("aria-checked", "true");
  const japaneseInitiallyEnabled = await japaneseSwitch.getAttribute("aria-checked") === "true";

  let japaneseChanged = false;
  try {
    if (japaneseInitiallyEnabled) {
      await japaneseSwitch.click();
      const disableResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/merchant/stalls/${stallId}/modules`)
        && response.request().method() === "PATCH"
      ));
      await localeSection.getByRole("button", { name: "儲存語系設定" }).click();
      expect((await disableResponse).status()).toBe(200);
      japaneseChanged = true;
    }
    await expect(japaneseSwitch).toHaveAttribute("aria-checked", "false");

    const japaneseContext = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Taipei" });
    try {
      const japanesePage = await japaneseContext.newPage();
      await japanesePage.goto("/q/demo-aming-chicken-qr-2026-rotate-me");
      const languageMenu = japanesePage.getByRole("button", { name: "點餐語言" });
      await expect(languageMenu).toHaveAttribute("data-current-locale", "zh-TW");
      await languageMenu.click();
      await expect(japanesePage.getByRole("option", { name: "日本語", exact: true })).toHaveCount(0);
    } finally {
      await japaneseContext.close();
    }
  } finally {
    if (japaneseChanged) {
      await japaneseSwitch.click();
      const restoreResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/merchant/stalls/${stallId}/modules`)
        && response.request().method() === "PATCH"
      ));
      await localeSection.getByRole("button", { name: "儲存語系設定" }).click();
      expect((await restoreResponse).status()).toBe(200);
      await expect(japaneseSwitch).toHaveAttribute("aria-checked", "true");
    }
  }

  const floorEditor = page.getByRole("region", { name: "桌位平面配置" });
  await expect(floorEditor).toBeVisible();
  const floorTable = floorEditor.getByRole("button", { name: "移動 A1 桌" });
  const originalPosition = await floorTable.evaluate((element) => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }));
  const moveKey = Number.parseFloat(originalPosition.left) >= 82 ? "ArrowLeft" : "ArrowRight";
  const restoreKey = moveKey === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
  await floorTable.press(moveKey);
  expect(await floorTable.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(originalPosition.left);
  const layoutResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/merchant/stalls/${stallId}/modules`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "儲存桌位位置" }).click();
  expect((await layoutResponse).status()).toBe(200);
  await floorTable.press(restoreKey);
  const restoreLayoutResponse = page.waitForResponse((response) => (
    response.url().includes(`/api/merchant/stalls/${stallId}/modules`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "儲存桌位位置" }).click();
  expect((await restoreLayoutResponse).status()).toBe(200);
  expect(await floorTable.evaluate((element) => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }))).toEqual(originalPosition);
  await expect(page.locator('input[value="A1 桌"]')).toBeVisible();
  await expect(page.locator('input[value="LINE Pay"]')).toBeVisible();
  await expect(page.locator('input[value="街口支付"]')).toBeVisible();
  await expect(page.locator('input[value="9 折"]')).toBeVisible();

  await page.goto(`/merchant/team?organizationId=${organizationId}`);
  await expect(page.getByText("最高擁有者", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/變更.*組織角色/).first()).toBeDisabled();

  await page.goto(`/merchant/reports/overview?organizationId=${organizationId}`);
  await expect(page.getByRole("button", { name: "日", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "週", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "月", exact: true })).toBeVisible();
  await expect(page.getByText("00:00", { exact: true })).toBeVisible();
  await expect(page.getByText("23:00", { exact: true })).toBeVisible();

  await page.goto("/merchant/aming-chicken");
  await expect(page.getByRole("button", { name: "批次售完" })).toBeVisible();
  await expect(page.getByLabel("供應開始").first()).toBeVisible();
  await expect(page.getByLabel("供應結束").first()).toBeVisible();
  await page.getByText("安全與訂單限制", { exact: true }).click();
  await expect(page.getByLabel("顧客預估等候分鐘")).toHaveValue("15");
  await expect(page.getByLabel("營業日切換時間")).toHaveValue("0");

  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(page.getByRole("link", { name: "匯出 CSV" })).toBeVisible();
  await expect(page.getByText("匯入 CSV", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "商品註記群組" })).toBeVisible();
  await expect(page.getByText("辣度", { exact: true })).toBeVisible();
  await expect(page.getByText("加蛋", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "複製 香酥雞排" })).toBeVisible();
  const validCsvRow = ["", "測試分類", "", "匯入預覽商品", "", "88", "", "1", "true", "AMING-01", "Preview item", "", "", "", "", "", "", "", "", ""];
  const invalidCsvRow = ["", "測試分類", "", "錯誤價格商品", "", "=100", "", "2", "true", "AMING-01", "", "", "", "", "", "", "", "", "", ""];
  await page.getByText("匯入 CSV", { exact: true }).locator("input[type=file]").setInputFiles({
    name: "catalog-preview.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([catalogCsvHeaders.join(","), validCsvRow.join(","), invalidCsvRow.join(",")].join("\n")),
  });
  const importDialog = page.getByRole("dialog", { name: "CSV 匯入預覽" });
  await expect(importDialog.getByRole("button", { name: "套用 1 筆有效資料" })).toBeVisible();
  await expect(importDialog.getByRole("button", { name: "下載錯誤 CSV" })).toBeVisible();
  await importDialog.getByRole("button", { name: "關閉" }).click();
  await page.getByRole("button", { name: "編輯 香酥雞排" }).click();
  const editor = page.getByRole("dialog", { name: "編輯商品" });
  await expect(editor.getByLabel("圖片網址")).toBeVisible();
  await expect(editor.getByText("本機上傳", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("英文名稱")).toHaveValue("Deep-Fried Chicken Cutlet");
  await expect(editor.getByLabel("日文名稱")).toHaveValue("鶏肉の揚げ物");
});
