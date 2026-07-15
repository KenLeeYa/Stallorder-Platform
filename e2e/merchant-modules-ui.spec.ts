import { expect, test } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test("商戶可檢視營運模組、鎖定擁有者、報表快捷與商品多語欄位", async ({ page }) => {
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
  await expect(page.getByRole("switch", { name: /內用桌位/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: /訂單列印/ })).toHaveAttribute("aria-checked", "true");
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

  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  await expect(page.getByRole("link", { name: "匯出 CSV" })).toBeVisible();
  await expect(page.getByText("匯入 CSV", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "編輯 香酥雞排" }).click();
  const editor = page.getByRole("dialog", { name: "編輯商品" });
  await expect(editor.getByLabel("圖片網址")).toBeVisible();
  await expect(editor.getByText("本機上傳", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("英文名稱")).toHaveValue("Crispy Chicken Cutlet");
  await expect(editor.getByLabel("日文名稱")).toHaveValue("サクサク鶏排");
});
