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

    const feedback = page.getByRole("alertdialog", { name: "請確認設定", exact: true });
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
