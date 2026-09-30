import { expect, test } from "@playwright/test";
import {
  addFirstStaffCatalogProduct,
  dismissStaffStartReminder,
  gotoLocalPath,
  loginLocalTestAccount,
} from "./local-navigation";

test.use({ serviceWorkers: "block" });

for (const width of [320, 390, 768, 1024]) {
  test(`POS ${width}px 核對份數、總額、實收與找零後才提交`, async ({ page }) => {
    await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
    await page.setViewportSize({ width, height: 844 });
    await gotoLocalPath(page, "/staff/aming-chicken");
    await dismissStaffStartReminder(page);
    await page.getByRole("button", { name: "店員點餐", exact: true }).click();
    const pos = page.getByRole("dialog", { name: "店員點餐", exact: true });
    await addFirstStaffCatalogProduct(page, pos);
    if (width < 768) await pos.getByTestId("staff-order-cart-tab").click();
    const total = pos.getByTestId("staff-cart-live-total");
    await expect(total).toContainText("1 份");
    await expect(total.locator("strong")).toContainText("$");
    await pos.getByTestId("staff-tablet-confirm-order").click();
    const cashRow = pos.getByTestId("staff-checkout-cash-row");
    const quick = cashRow.getByTestId("cash-quick-amounts");
    const input = cashRow.getByRole("textbox");
    await input.fill("10000");
    await expect(input).toHaveValue("10000");
    expect(await input.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const button of await quick.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const change = pos.getByTestId("cash-change-summary");
    await expect(change).toContainText("應找零");
    await expect(change.locator("strong")).toBeVisible();
    await input.fill("1");
    await expect(change).toContainText("尚差");
    await expect(change.locator("strong")).toBeVisible();
    const submit = pos.getByRole("button", { name: "建立訂單並收款", exact: true });
    const submitBox = await submit.boundingBox();
    expect(submitBox!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
