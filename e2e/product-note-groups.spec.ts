import { expect, test, type Page } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";
const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
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
  await expect(page.getByRole("heading", { name: "商品註記設定" })).toBeVisible();
  await page.getByRole("tab", { name: "註記群組" }).click();
  await expect(page.getByText("辣度", { exact: true })).toBeVisible();
  await expect(page.getByText("加料", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新增群組", exact: true }).click();
  const groupEditor = page.getByRole("dialog", { name: "新增註記群組" });
  const groupNameInput = groupEditor.getByLabel("群組名稱");
  const invalidGroupResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "CREATE_NOTE_GROUP"
  ));
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidGroupResponse).status()).toBe(400);
  await expect(groupEditor.getByText("「名稱」輸入不正確，請依欄位限制重新輸入。", { exact: true }).first()).toBeVisible();
  await expect(groupNameInput).toHaveAttribute("aria-invalid", "true");
  await expect(groupNameInput).toBeFocused();
  await expect(groupNameInput).toHaveValue("");

  await groupNameInput.fill(groupName);
  await groupEditor.getByLabel("選取方式").selectOption("SINGLE");
  await groupEditor.getByLabel("顧客必須選擇").check();
  await expect(groupEditor.getByLabel("最少選取數")).toHaveValue("1");
  const assignedProduct = groupEditor.getByLabel("冬瓜茶", { exact: true });
  await assignedProduct.check();
  await groupEditor.getByText("多語名稱", { exact: true }).click();
  await groupEditor.getByLabel("英文", { exact: true }).fill("Sweetness");

  const productAssignments = groupEditor.getByRole("group", { name: "指派商品" });
  await expect(productAssignments).toHaveAttribute("data-field-key", "productIds");
  await expect(productAssignments).toHaveAttribute("tabindex", "-1");
  await page.route(`**/api/merchant/organizations/${organizationId}/product-notes`, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "「指派商品」輸入不正確，請依欄位限制重新輸入。",
        fieldErrors: { productIds: "「指派商品」輸入不正確，請依欄位限制重新輸入。" },
      }),
    });
  }, { times: 1 });
  const invalidAssignmentsResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
  ));
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  expect((await invalidAssignmentsResponse).status()).toBe(400);
  await expect(productAssignments).toHaveAttribute("aria-invalid", "true");
  await expect(productAssignments).toBeFocused();
  await expect(groupNameInput).toHaveValue(groupName);
  await assignedProduct.uncheck();
  await expect(productAssignments).toHaveAttribute("aria-invalid", "false");
  await assignedProduct.check();

  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已新增。");

  const group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await expect(group).toContainText("冬瓜茶");
  await expect(group).toContainText("最少 1 項");
  await group.getByRole("button", { name: "新增群組專用註記" }).click();

  const optionEditor = page.getByRole("dialog", { name: "新增群組專用註記" });
  await optionEditor.getByLabel("註記名稱").fill("正常甜");
  await optionEditor.getByLabel("價格調整").fill("5");
  await optionEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已新增。");
  await expect(group).toContainText("正常甜");

  await group.getByLabel("編輯 正常甜").click();
  const editOption = page.getByRole("dialog", { name: "編輯群組專用註記" });
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

test("群組內共用與專用註記排序可儲存並於重載後保留", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const groupName = `排序群組 QA ${suffix}`;
  const reusableName = `共用排序 QA ${suffix}`;
  const dedicatedName = `專用排序 QA ${suffix}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  await page.getByRole("button", { name: "新增單一註記" }).click();
  const reusableEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
  await reusableEditor.getByLabel("註記名稱").fill(reusableName);
  await reusableEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已新增。");

  await page.getByRole("tab", { name: "註記群組" }).click();
  await page.getByRole("button", { name: "新增群組", exact: true }).click();
  const groupEditor = page.getByRole("dialog", { name: "新增註記群組" });
  await groupEditor.getByLabel("群組名稱").fill(groupName);
  await groupEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已新增。");

  let group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  await group.getByRole("button", { name: "新增群組專用註記" }).click();
  const dedicatedEditor = page.getByRole("dialog", { name: "新增群組專用註記" });
  await dedicatedEditor.getByLabel("註記名稱").fill(dedicatedName);
  await dedicatedEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("註記選項已新增。");

  await group.getByLabel("加入既有共用註記").selectOption({ label: reusableName });
  await group.getByRole("button", { name: "加入群組", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已加入群組。");

  await group.getByLabel(`調整排序 ${reusableName}`).click();
  const reusableSortEditor = page.getByRole("dialog", { name: "調整群組內排序" });
  await reusableSortEditor.getByLabel("排序").fill("0");
  const reusableSortResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "UPDATE_NOTE_OPTION"
  ));
  await reusableSortEditor.getByRole("button", { name: "儲存" }).click();
  expect((await reusableSortResponse).status()).toBe(200);

  await group.getByLabel(`編輯 ${dedicatedName}`).click();
  const dedicatedSortEditor = page.getByRole("dialog", { name: "編輯群組專用註記" });
  await dedicatedSortEditor.getByLabel("排序").fill("5");
  const dedicatedSortResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/product-notes`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "UPDATE_NOTE_OPTION"
  ));
  await dedicatedSortEditor.getByRole("button", { name: "儲存" }).click();
  expect((await dedicatedSortResponse).status()).toBe(200);

  await page.reload();
  await page.getByRole("tab", { name: "註記群組" }).click();
  group = page.locator("details").filter({ has: page.getByText(groupName, { exact: true }) }).first();
  const optionNames = group.locator(".divide-y.divide-stone-100 > div > div:first-child > span.text-sm.font-medium");
  await expect(optionNames).toHaveText([reusableName, dedicatedName]);

  page.once("dialog", (dialog) => dialog.accept());
  await group.getByLabel(`刪除 ${groupName}`).click();
  await expect(page.getByRole("status")).toHaveText("註記群組已刪除。");
  await page.getByRole("tab", { name: "所有單一註記" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${reusableName}`).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已刪除。");
});

test("共用單一註記可加入多個群組、同步更新並阻擋使用中刪除", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const noteName = `香菜另外放 QA ${suffix}`;
  const updatedName = `香菜另放 QA ${suffix}`;

  await login(page, "owner@stallorder.test");
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(page.getByRole("tab", { name: "所有單一註記" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "新增單一註記" }).click();
  const createEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
  await createEditor.getByLabel("註記名稱").fill(noteName);
  await createEditor.getByLabel("價格調整").fill("7");
  await createEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已新增。");

  await page.getByRole("button", { name: "新增單一註記" }).click();
  const duplicateEditor = page.getByRole("dialog", { name: "新增共用單一註記" });
  const duplicateName = duplicateEditor.getByLabel("註記名稱");
  await duplicateName.fill(noteName);
  await duplicateEditor.getByRole("button", { name: "儲存" }).click();
  await expect(duplicateEditor.getByRole("alert")).toHaveText("已有相同名稱的共用單一註記，請使用其他名稱。");
  await expect(duplicateName).toHaveAttribute("aria-invalid", "true");
  await expect(duplicateName).toBeFocused();
  await duplicateEditor.getByRole("button", { name: "關閉" }).click();

  await page.getByRole("tab", { name: "註記群組" }).click();
  const spiceGroup = page.locator("details").filter({ has: page.getByText("辣度", { exact: true }) }).first();
  const toppingGroup = page.locator("details").filter({ has: page.getByText("加料", { exact: true }) }).first();
  const emptyAttachSelect = spiceGroup.getByLabel("加入既有共用註記", { exact: true });
  const emptyAttachButton = spiceGroup.getByRole("button", { name: "加入群組", exact: true });
  await expect(emptyAttachButton).toBeEnabled();
  await emptyAttachButton.click();
  await expect(spiceGroup.getByText("請先選擇要加入群組的共用單一註記。", { exact: true })).toBeVisible();
  await expect(emptyAttachSelect).toHaveAttribute("aria-invalid", "true");
  await expect(emptyAttachSelect).toBeFocused();
  await emptyAttachSelect.selectOption({ label: noteName });
  await expect(emptyAttachSelect).toHaveAttribute("aria-invalid", "false");
  for (const group of [spiceGroup, toppingGroup]) {
    await group.getByLabel("加入既有共用註記").selectOption({ label: noteName });
    await group.getByRole("button", { name: "加入群組", exact: true }).click();
    await expect(group.getByLabel(`從群組移除 ${noteName}`)).toBeVisible();
  }

  await page.getByRole("tab", { name: "所有單一註記" }).click();
  await page.getByLabel(`編輯 ${noteName}`).click();
  const editEditor = page.getByRole("dialog", { name: "編輯共用單一註記" });
  await editEditor.getByLabel("註記名稱").fill(updatedName);
  await editEditor.getByLabel("價格調整").fill("9");
  await editEditor.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已更新，所有群組已同步。");
  await expect(page.getByText("已加入 2 個群組", { exact: false })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${updatedName}`).click();
  await expect(page.getByRole("status")).toHaveText("此共用註記仍在註記群組中使用，請先從所有群組移除。");

  await page.getByRole("tab", { name: "註記群組" }).click();
  for (const group of [spiceGroup, toppingGroup]) {
    await expect(group.getByText(updatedName, { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await group.getByLabel(`從群組移除 ${updatedName}`).click();
    await expect(group.getByLabel(`從群組移除 ${updatedName}`)).toHaveCount(0);
  }

  await page.getByRole("tab", { name: "所有單一註記" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel(`刪除 ${updatedName}`).click();
  await expect(page.getByRole("status")).toHaveText("共用單一註記已刪除。");
  await expect(page.getByText(updatedName, { exact: true })).toHaveCount(0);
});

test("QR 依瀏覽器語系自動切換並保留手動選擇", async ({ browser }) => {
  const baseURL = String(test.info().project.use.baseURL ?? "http://localhost:3001");
  const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: "Asia/Taipei" });
  const page = await context.newPage();

  try {
    const sessionResponse = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`/q/${takeoutQrToken}`);
    expect((await sessionResponse).status()).toBe(201);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByRole("button", { name: "メニュー言語" })).toHaveAttribute("data-current-locale", "ja");
    await expect(page.getByRole("heading", { name: "揚げ物", exact: true })).toBeVisible();
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
  await page.getByRole("article").filter({ hasText: "台式鹽酥雞" })
    .getByRole("button", { name: "加入購物車" }).click();
  await page.getByLabel("顧客稱呼").fill(customerName);
  await page.getByLabel("訂單備註").fill("胡椒少一點");
  await expect(page.getByTestId("qr-cart-panel").getByText("$90", { exact: true }).last()).toBeVisible();
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
