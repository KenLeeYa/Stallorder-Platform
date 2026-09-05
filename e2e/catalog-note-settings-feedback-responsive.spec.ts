import { expect, test } from "@playwright/test";
import {
  gotoLocalPath,
  loginLocalTestAccount,
  waitForDefaultMerchantDashboard,
} from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";

test.use({ serviceWorkers: "block" });

test("單一註記分層遮罩與設定回饋通過響應式矩陣", async ({ page }) => {
  test.setTimeout(120_000);
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
  await waitForDefaultMerchantDashboard(page, organizationId);

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoLocalPath(page, `/merchant/catalog?organizationId=${organizationId}`);

    const noteEntry = page
      .getByTestId("open-reusable-note-navigator")
      .filter({ visible: true });
    const groupEntry = page
      .getByTestId("open-note-group-navigator")
      .filter({ visible: true });
    await expect(noteEntry).toBeVisible();
    await expect(groupEntry).toBeVisible();
    expect((await noteEntry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await groupEntry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noteEntry.click();

    const noteNavigator = page.getByTestId("reusable-note-navigator-dialog");
    await expect(noteNavigator).toBeVisible();
    await expect(noteNavigator.getByPlaceholder("搜尋單一註記")).toBeVisible();
    await expect(noteNavigator.getByRole("button", { name: "新增單一註記", exact: true })).toBeVisible();
    await expect(noteNavigator.getByRole("button", { name: "關閉", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const noteNavigatorBox = await noteNavigator.boundingBox();
    expect(noteNavigatorBox).not.toBeNull();
    expect(noteNavigatorBox!.width).toBeLessThanOrEqual(viewport.width);
    await noteNavigator.getByRole("button", { name: "關閉", exact: true }).click();

    await gotoLocalPath(page, `/merchant/stalls/${stallId}/settings/order-limits`);
    const estimatedWait = page.getByLabel("顧客預估等候分鐘");
    await estimatedWait.fill("");
    await page.getByRole("button", { name: "儲存限制", exact: true }).click();

    const feedback = page.getByRole("alertdialog", { name: "請確認", exact: true });
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("請修正標示欄位後再儲存。");
    await expect(page.getByText("顧客預估等候分鐘為必填欄位。", { exact: true })).toBeVisible();
    const acknowledge = feedback.getByRole("button", { name: "我知道了", exact: true });
    await expect(acknowledge).toBeFocused();
    expect((await acknowledge.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const feedbackBox = await feedback.boundingBox();
    expect(feedbackBox).not.toBeNull();
    expect(feedbackBox!.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(Math.abs(feedbackBox!.x + feedbackBox!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await acknowledge.click();
    await expect(estimatedWait).toBeFocused();
  }
});

test("編輯商品以明確提示展開與收合商品翻譯", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
  await waitForDefaultMerchantDashboard(page, organizationId);
  await gotoLocalPath(page, `/merchant/catalog?organizationId=${organizationId}`);

  await page.getByTestId("open-catalog-navigator").filter({ visible: true }).click();
  const catalogNavigator = page.getByTestId("catalog-navigator-dialog");
  await expect(catalogNavigator).toBeVisible();
  await catalogNavigator.getByPlaceholder("搜尋所有商品").fill("香酥雞排");
  await catalogNavigator.getByTestId("shared-product-actions").first().click();
  await catalogNavigator.getByRole("button", { name: "編輯商品", exact: true }).click();

  const productEditor = page.getByRole("dialog", { name: "編輯商品", exact: true });
  await expect(productEditor).toBeVisible();
  const translationDisclosure = productEditor.locator("details").filter({ hasText: "商品翻譯" });
  const translationSummary = translationDisclosure.locator("summary");
  await expect(translationSummary.getByText("商品翻譯", { exact: true })).toBeVisible();
  await expect(translationSummary.getByText("展開／收合", { exact: true })).toBeVisible();
  await expect(translationDisclosure).not.toHaveAttribute("open", "");

  await translationSummary.click();
  await expect(translationDisclosure).toHaveAttribute("open", "");
  await expect(translationDisclosure.locator("input").first()).toBeVisible();

  await translationSummary.click();
  await expect(translationDisclosure).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
