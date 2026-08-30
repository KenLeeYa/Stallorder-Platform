import { expect, test } from "@playwright/test";
import { waitForDefaultMerchantDashboard } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";

test("單店入口、商品摺疊與訂單限制設定維持一致", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await waitForDefaultMerchantDashboard(page, organizationId);
  const merchantMain = page.locator("#main-content");
  await expect(merchantMain).toHaveCount(1);
  await expect(merchantMain.getByText("營運總覽", { exact: true })).toBeVisible();

  await page.goto(`/merchant/stalls?organizationId=${organizationId}`);
  await expect(page.getByRole("heading", { name: "管理攤位", exact: true })).toBeVisible();
  for (const heading of ["攤位設定", "營運工具", "組織管理"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "基本資料", exact: true }))
    .toHaveAttribute("href", `/merchant/stalls/${stallId}/settings/basic`);
  await expect(page.getByRole("link", { name: "設定", exact: true })).toHaveCount(0);

  await page.goto("/merchant/aming-chicken");
  const productList = page.locator("details[data-stall-product-list]");
  await expect(productList).toHaveAttribute("open", "");
  await productList.locator("summary").first().click();
  await expect(productList).not.toHaveAttribute("open", "");
  await productList.locator("summary").first().click();
  await expect(page.getByText("安全與訂單限制", { exact: true })).toHaveCount(0);

  await page.goto(`/merchant/stalls/${stallId}/settings/order-limits`);
  await expect(page.getByRole("heading", { name: "安全與訂單限制", exact: true })).toBeVisible();
  const estimatedWaitInput = page.getByLabel("顧客預估等候分鐘");
  await expect(estimatedWaitInput).toHaveValue("15");

  await estimatedWaitInput.fill("");
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  await expect(estimatedWaitInput).toHaveValue("");
  await expect(estimatedWaitInput).toBeFocused();
  await expect(page.getByText("顧客預估等候分鐘為必填欄位。", { exact: true })).toBeVisible();

  await estimatedWaitInput.fill("241");
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  await expect(page.getByText("顧客預估等候分鐘請輸入 0 到 240 之間。", { exact: true })).toBeVisible();

  await estimatedWaitInput.fill("1.5");
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  await expect(page.getByText("顧客預估等候分鐘請輸入整數。", { exact: true })).toBeVisible();

  await estimatedWaitInput.fill("15");
  const limitsResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/ordering")
    && response.request().method() === "PATCH"
    && response.request().postDataJSON()?.action === "UPDATE_LIMITS"
  ));
  await page.getByRole("button", { name: "儲存限制", exact: true }).click();
  expect((await limitsResponse).status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("安全與訂單限制已更新。");
});
