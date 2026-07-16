import { expect, test, type Page } from "@playwright/test";
import { catalogCsvHeaders } from "../src/lib/catalog-csv";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

async function verifyCollapsibleHeader(page: Page, title: string) {
  const heading = page.getByRole("heading", { name: title, exact: true });
  const summary = heading.locator("xpath=ancestor::summary[1]");
  const details = summary.locator("xpath=..");
  await expect(summary.locator("svg").first()).toBeVisible();
  const initiallyOpen = await details.evaluate((element) => (element as HTMLDetailsElement).open);
  await summary.click();
  await expect.poll(() => details.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(!initiallyOpen);
  await summary.click();
  await expect.poll(() => details.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(initiallyOpen);
}

test("商戶可管理營運模組與 QR 語系，並檢視其他營運設定", async ({ browser, page }) => {
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
  await expect(page.getByRole("heading", { name: "營運模組與內用桌位" })).toBeVisible();
  for (const title of [
    "基本資料",
    "營運狀態",
    "營運模組與內用桌位",
    "QR 點餐語系",
    "內用桌位與專屬 QR",
    "桌位平面配置",
    "付款方式",
    "結帳折扣",
    "攤位成員",
  ]) {
    await verifyCollapsibleHeader(page, title);
  }
  await page.getByRole("button", { name: "全部收合" }).click();
  await expect.poll(() => page.locator("details[open]").count()).toBe(0);
  await page.getByRole("button", { name: "全部展開" }).click();
  await expect.poll(() => page.locator("details[open]").count()).toBeGreaterThan(5);
  const settingsSearch = page.getByPlaceholder("搜尋設定");
  await settingsSearch.fill("付款方式");
  await expect(page.getByRole("heading", { name: "付款方式" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "基本資料" })).toBeHidden();
  await settingsSearch.fill("");
  const phoneInput = page.getByLabel("電話", { exact: true });
  const originalPhone = await phoneInput.inputValue();
  await phoneInput.fill(`${originalPhone}0`);
  await expect(page.getByText("1 個區段尚未儲存", { exact: true })).toBeVisible();
  await phoneInput.fill(originalPhone);
  await expect(page.getByText("1 個區段尚未儲存", { exact: true })).toHaveCount(0);

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

  await expect(page.getByRole("switch", { name: /內用桌位/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: /訂單列印/ })).toHaveAttribute("aria-checked", "true");
  const localeSection = page.locator('details[aria-label="QR 點餐語系"]');
  if (!(await localeSection.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await localeSection.locator("summary").click();
  }
  const traditionalChineseSwitch = localeSection.getByRole("switch", { name: /繁體中文/ });
  const japaneseSwitch = localeSection.getByRole("switch", { name: /日文/ });
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
      await expect(japanesePage.getByLabel("點餐語言")).toHaveValue("zh-TW");
      await expect(japanesePage.getByLabel("點餐語言").locator('option[value="ja"]')).toHaveCount(0);
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
