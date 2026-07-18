import { expect, test, type Page } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";
const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard|\/staff\//);
}

test("商家可新增、修改、指派與刪除商品註記群組", async ({ page }) => {
  test.setTimeout(120_000);
  const groupName = `甜度 QA ${Date.now()}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(page.getByRole("heading", { name: "商品註記群組" })).toBeVisible();
  await expect(page.getByText("辣度", { exact: true })).toBeVisible();
  await expect(page.getByText("加料", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新增群組" }).click();
  const groupEditor = page.getByRole("dialog", { name: "新增註記群組" });
  await groupEditor.getByLabel("群組名稱").fill(groupName);
  await groupEditor.getByLabel("選取方式").selectOption("SINGLE");
  await groupEditor.getByLabel("顧客必須選擇").check();
  await expect(groupEditor.getByLabel("最少選取數")).toHaveValue("1");
  await groupEditor.getByLabel("冬瓜茶", { exact: true }).check();
  await groupEditor.getByText("多語名稱", { exact: true }).click();
  await groupEditor.getByLabel("英文", { exact: true }).fill("Sweetness");
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已新增。");

  const group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await expect(group).toContainText("冬瓜茶");
  await expect(group).toContainText("最少 1 項");
  await group.getByRole("button", { name: "註記選項" }).click();

  const optionEditor = page.getByRole("dialog", { name: "新增註記選項" });
  await optionEditor.getByLabel("註記名稱").fill("正常甜");
  await optionEditor.getByLabel("價格調整").fill("5");
  await optionEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已新增。");
  await expect(group).toContainText("正常甜");

  await group.getByLabel("編輯 正常甜").click();
  const editOption = page.getByRole("dialog", { name: "編輯註記選項" });
  await editOption.getByLabel("註記名稱").fill("固定甜度");
  await editOption.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已更新。");
  await expect(group).toContainText("固定甜度");

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel("刪除 固定甜度").click();
  await expect(page.getByRole("status")).toHaveText("註記選項已刪除。");

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel(`刪除 ${groupName}`).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已刪除。");
  await expect(page.getByText(groupName, { exact: true })).toHaveCount(0);
});

test("QR 依瀏覽器語系自動切換並保留手動選擇", async ({ browser }) => {
  const baseURL = String(test.info().project.use.baseURL ?? "http://localhost:3001");
  const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: "Asia/Taipei" });
  const page = await context.newPage();

  try {
    await page.goto(`/q/${takeoutQrToken}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByRole("button", { name: "メニュー言語" })).toHaveAttribute("data-current-locale", "ja");
    await expect(page.getByText("揚げ物", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "台湾風鶏の唐揚げ" })).toBeVisible();

    await page.getByRole("button", { name: "台湾風鶏の唐揚げを増やす" }).click();
    await expect(page.getByRole("group", { name: /辛さ/ })).toBeVisible();
    await expect(page.getByLabel("小辛", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /追加トッピング/ })).toBeVisible();

    await page.getByRole("button", { name: "メニュー言語" }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Pepper Popcorn Chicken" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Menu language" })).toHaveAttribute("data-current-locale", "en");
    await expect(page.getByRole("heading", { name: "Pepper Popcorn Chicken" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("QR 註記選擇會由後端驗價並顯示於店員訂單", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const customerName = `註記 QA ${Date.now()}`;

  await page.goto(`/q/${takeoutQrToken}`);
  await page.getByRole("button", { name: "增加 台式鹽酥雞" }).click();
  await expect(page.getByRole("group", { name: /辣度/ })).toBeVisible();
  await page.getByLabel("中辣", { exact: true }).check();
  await page.getByLabel(/加蛋/).check();
  await page.getByLabel("顧客稱呼").fill(customerName);
  await page.getByLabel("訂單備註").fill("胡椒少一點");
  await expect(page.getByText("$90", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeEnabled({ timeout: 20_000 });

  const createResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "送出訂單", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText(/辣度：中辣.*加料：加蛋/)).toBeVisible();

  const staffContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
  await expect(staffOrder).toContainText("辣度：中辣");
  await expect(staffOrder).toContainText("加料：加蛋");
  await expect(staffOrder).toContainText("胡椒少一點");
  await expect(staffOrder).toContainText("$90");

  await staffOrder.getByRole("button", { name: "取消訂單" }).click();
  const cancellation = staffPage.getByRole("alertdialog", { name: "確認取消訂單？" });
  await expect(cancellation).toContainText(customerName);
  await cancellation.getByRole("button", { name: "確認取消訂單" }).click();
  await expect(staffOrder).toHaveCount(0);
  await staffContext.close();
});
