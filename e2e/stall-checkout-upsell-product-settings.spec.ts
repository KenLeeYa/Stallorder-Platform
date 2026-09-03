import { expect, test, type Page } from "@playwright/test";
import {
  loginLocalTestAccount,
  openSharedCatalogProductActions,
} from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const password = "StallOrderDemo!2026";

test.use({ serviceWorkers: "block" });

async function loginAsOwner(page: Page) {
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
}

test("共享商品編輯頁可依攤位設定推薦加點", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/merchant/catalog?organizationId=${organizationId}`);
  const productActions = await openSharedCatalogProductActions(page, "香酥雞排");
  await productActions.getByRole("button", { name: "編輯商品", exact: true }).click();

  let editor = page.getByRole("dialog", { name: "編輯商品", exact: true });
  const lotterySwitch = editor.getByRole("switch", { name: "可作為抽抽樂推薦／免費贈品", exact: true });
  const upsellSwitch = editor.getByTestId("shared-product-upsell-switch");
  await expect(lotterySwitch).toBeVisible();
  await expect(upsellSwitch).toBeVisible();
  expect((await upsellSwitch.boundingBox())!.y).toBeGreaterThan((await lotterySwitch.boundingBox())!.y);

  const originalState = await upsellSwitch.getAttribute("aria-checked");
  if (await upsellSwitch.isEnabled()) await upsellSwitch.click();
  const saveResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/api/merchant/organizations/${organizationId}/catalog`)
    && response.request().postDataJSON()?.operation === "UPDATE_PRODUCT"
  ));
  await editor.getByRole("button", { name: "儲存", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);

  const reopenedActions = await openSharedCatalogProductActions(page, "香酥雞排");
  await reopenedActions.getByRole("button", { name: "編輯商品", exact: true }).click();
  editor = page.getByRole("dialog", { name: "編輯商品", exact: true });
  const persistedSwitch = editor.getByTestId("shared-product-upsell-switch");
  await expect(persistedSwitch).toHaveAttribute(
    "aria-checked",
    originalState === "true" ? "false" : "true",
  );

  if (await persistedSwitch.isEnabled()) await persistedSwitch.click();
  const restoreResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/api/merchant/organizations/${organizationId}/catalog`)
  ));
  await editor.getByRole("button", { name: "儲存", exact: true }).click();
  expect((await restoreResponse).status()).toBe(200);
});

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`${viewport.name} 商品內頁提供大型推薦加點開關`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await loginAsOwner(page);
    await page.goto("/merchant/aming-chicken");

    if (viewport.width < 1280) {
      await page.getByRole("button", {
        name: "攤位商品設定",
        exact: true,
      }).click();
    }

    const trigger = page.getByTestId("stall-product-settings-trigger").first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByTestId("stall-product-settings-dialog");
    const recommendationSwitch = dialog.getByTestId("stall-product-upsell-switch");
    await expect(dialog).toBeVisible();
    await expect(recommendationSwitch).toBeVisible();
    await expect(recommendationSwitch).toHaveAttribute("role", "switch");
    expect((await recommendationSwitch.boundingBox())?.height).toBeGreaterThanOrEqual(64);
    await expect(dialog.getByRole("button", { name: "關閉", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "儲存設定", exact: true })).toBeFocused();

    const savedState = await recommendationSwitch.getAttribute("aria-checked");
    if (await recommendationSwitch.isEnabled()) {
      await recommendationSwitch.click();
      await expect(recommendationSwitch).not.toHaveAttribute("aria-checked", savedState ?? "false");
    }

    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(
      page.getByTestId("stall-product-upsell-switch"),
    ).toHaveAttribute("aria-checked", savedState ?? "false");

    await dialog.getByRole("button", { name: "儲存設定", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const feedback = page.getByRole("dialog", { name: "設定已完成", exact: true });
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("設定已儲存");
    const feedbackBox = await feedback.boundingBox();
    expect(feedbackBox).not.toBeNull();
    expect(Math.abs(feedbackBox!.x + feedbackBox!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    await feedback.getByRole("button", { name: "我知道了", exact: true }).click();
  });
}
