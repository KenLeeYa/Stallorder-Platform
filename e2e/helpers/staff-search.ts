import { expect, type Page } from "@playwright/test";

export async function searchStaffOrders(page: Page, query: string) {
  const search = page.getByTestId("staff-search-open").filter({ visible: true });
  await expect(search).toHaveCount(1);
  await search.click();
  const dialog = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
  await dialog.getByRole("searchbox").fill(query);
  await dialog.getByRole("button", { name: "確認", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
