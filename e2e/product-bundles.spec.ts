import { expect, test, type Page } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/);
}

test("商家可建立套餐、選擇群組與一般商品選項", async ({ page }) => {
  test.setTimeout(120_000);
  const bundleName = `套餐 QA ${Date.now()}`;
  const choiceGroupName = "主餐任選";

  await login(page);
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);

  await page.getByRole("button", { name: "商品", exact: true }).click();
  const productEditor = page.getByRole("dialog", { name: "新增商品" });
  await productEditor.getByLabel("商品名稱").fill(bundleName);
  await productEditor.getByLabel("商品類型").selectOption("BUNDLE");
  await productEditor.getByLabel("套餐組合價").fill("180");
  await productEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("商品已新增。");

  await page.getByRole("button", { name: `設定 ${bundleName} 套餐內容` }).click();
  const bundleEditor = page.getByRole("dialog", { name: `設定「${bundleName}」套餐內容` });
  await expect(bundleEditor.getByText("套餐組合價：$180", { exact: true })).toBeVisible();

  await bundleEditor.getByRole("button", { name: "新增群組", exact: true }).click();
  const choiceGroupNameInput = bundleEditor.getByLabel("群組名稱");
  const invalidChoiceGroupResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/merchant/organizations/${organizationId}/catalog`
    && response.request().method() === "POST"
    && response.request().postDataJSON()?.operation === "CREATE_BUNDLE_CHOICE_GROUP"
  ));
  await bundleEditor.getByRole("button", { name: "儲存", exact: true }).click();
  expect((await invalidChoiceGroupResponse).status()).toBe(400);
  await expect(bundleEditor.getByText("「名稱」輸入不正確，請依欄位限制重新輸入。", { exact: true }).first()).toBeVisible();
  await expect(choiceGroupNameInput).toHaveAttribute("aria-invalid", "true");
  await expect(choiceGroupNameInput).toBeFocused();
  await expect(choiceGroupNameInput).toHaveValue("");

  await choiceGroupNameInput.fill(choiceGroupName);
  await bundleEditor.getByLabel("最少選擇").fill("2");
  await bundleEditor.getByLabel("最多選擇").fill("1");
  await bundleEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(bundleEditor.getByText("套餐群組最少選擇數不可大於最多選擇數。", { exact: true }).first()).toBeVisible();
  await expect(bundleEditor.getByLabel("最多選擇")).toHaveAttribute("aria-invalid", "true");
  await expect(bundleEditor.getByLabel("最多選擇")).toBeFocused();
  await bundleEditor.getByLabel("最少選擇").fill("1");
  await bundleEditor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("套餐選擇群組已新增。");

  const choiceGroup = bundleEditor.locator("section").filter({ hasText: choiceGroupName });
  await choiceGroup.getByRole("button", { name: "加入一般商品", exact: true }).click();
  await choiceGroup.getByLabel("一般商品").selectOption({ label: "香酥雞排" });
  await choiceGroup.getByLabel("數量").fill("2");
  await choiceGroup.getByLabel("價差").fill("20");
  await choiceGroup.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("套餐選項已新增。");
  await expect(choiceGroup).toContainText("香酥雞排 × 2");
  await expect(choiceGroup).toContainText("+$20");

  await bundleEditor.getByRole("button", { name: "關閉", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `刪除 ${bundleName}` }).click();
  await expect(page.getByRole("status")).toHaveText("商品已刪除，歷史訂單快照已保留。");
});
