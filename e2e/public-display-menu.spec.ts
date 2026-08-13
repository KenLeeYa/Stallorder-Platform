import { expect, test } from "@playwright/test";

test("公開 Menu 以匿名唯讀方式呈現並適合手機瀏覽", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu/aming-chicken");

  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  await expect(page.getByText("MENU · 公開菜單", { exact: true })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  const menuPage = page.locator("main");
  await expect(menuPage.getByText("熱銷", { exact: true }).first()).toBeVisible();
  await expect(menuPage.getByText(/熱銷第/)).toHaveCount(0);
  await expect(menuPage.getByText(/客製選項：.*加蛋.*\+\$15/).first()).toBeVisible();
  await expect(menuPage.getByText("起", { exact: true }).first()).toBeVisible();
  await expect(menuPage.getByRole("button")).toHaveCount(0);
  await expect(menuPage.locator("form")).toHaveCount(0);
  await expect(page.getByText("送出訂單", { exact: true })).toHaveCount(0);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontalOverflow).toBe(false);
});

test("不存在或不可公開的攤位不會洩漏菜單資料", async ({ request }) => {
  const response = await request.get("/menu/not-a-real-stall");
  expect(response.status()).toBe(404);
});
