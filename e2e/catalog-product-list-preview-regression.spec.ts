import { expect, test } from "@playwright/test";
import {
  catalogDesktopEditButton,
  catalogMobileEditButton,
} from "../scripts/lib/catalog-preview-locators.cjs";
import { gotoLocalPath, loginLocalTestAccount } from "./local-navigation";

const organizationId = "11111111-1111-4111-8111-111111111111";
const productName = "香酥雞排";
const commandPath = `/api/merchant/organizations/${organizationId}/catalog`;

test.use({ serviceWorkers: "block" });

test("catalog locators and preview harness load in one Playwright worker", async () => {
  const harness = await import("../scripts/qa-pr366-preview-ui.mjs");
  expect(typeof catalogDesktopEditButton).toBe("function");
  expect(typeof catalogMobileEditButton).toBe("function");
  expect(typeof harness.createPreviewContext).toBe("function");
});

for (const layout of ["desktop", "mobile"] as const) {
  test(`${layout} catalog list opens, cancels, and retains a failed edit`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: layout === "desktop" ? 1440 : 390, height: 900 });
    await loginLocalTestAccount(page, "owner@stallorder.test", "StallOrderDemo!2026");
    await gotoLocalPath(page, `/merchant/catalog?organizationId=${organizationId}`);
    await page.getByRole("searchbox", { name: "搜尋商品", exact: true }).fill(productName);
    await expect(page).toHaveURL(/q=/);

    const edit = layout === "desktop"
      ? catalogDesktopEditButton(page, productName)
      : catalogMobileEditButton(page, productName);
    if (layout === "desktop") {
      // The old hosted selector names only the hidden mobile-card button at this width.
      await expect(catalogMobileEditButton(page, productName)).toHaveCount(0);
    }
    await expect(edit).toBeVisible();
    const listUrl = page.url();
    await edit.click();
    const editor = page.getByRole("dialog", { name: "編輯商品", exact: true });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole("searchbox", { name: "搜尋商品", exact: true })).toHaveValue(productName);
    expect(page.url()).toBe(listUrl);

    await edit.click();
    await expect(editor).toBeVisible();
    await editor.getByLabel("商品名稱", { exact: true }).fill("PR366 transport failure — not persisted");
    let interceptedWrites = 0;
    await page.route(`**${commandPath}`, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      interceptedWrites += 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "隔離測試：模擬儲存失敗" }) });
    });
    try {
      const failed = page.waitForResponse((response) => new URL(response.url()).pathname === commandPath
        && response.request().method() === "POST");
      await editor.getByRole("button", { name: "儲存", exact: true }).click();
      expect((await failed).status()).toBe(503);
      expect(interceptedWrites).toBe(1);
      await expect(editor.getByRole("alert")).toContainText("隔離測試：模擬儲存失敗");
      await expect(editor).toBeVisible();
      expect(page.url()).toBe(listUrl);
      await editor.getByRole("button", { name: "關閉", exact: true }).click();
    } finally {
      await page.unroute(`**${commandPath}`);
    }
    await expect(editor).toBeHidden();
    await expect(page.getByRole("searchbox", { name: "搜尋商品", exact: true })).toHaveValue(productName);
    await page.reload();
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(editor.getByLabel("商品名稱", { exact: true })).toHaveValue(productName);
    await editor.getByRole("button", { name: "關閉", exact: true }).click();
    await expect(editor).toBeHidden();
    expect(page.url()).toBe(listUrl);
  });
}
