import { expect, type Page } from "@playwright/test";

export async function verifyQrMenuSearch(page: Page) {
  const search = page.getByRole("searchbox");
  const products = page.locator('article[id^="qr-product-"]');
  const categories = page.getByTestId("qr-category-navigation").getByRole("link");
  await expect(search).toBeEnabled();
  await expect(products.first()).toBeVisible();
  await expect(categories.first()).toBeVisible();
  const productCount = await products.count();
  const categoryCount = await categories.count();
  const firstName = (await products.first().getByRole("heading", { level: 3 }).innerText()).trim();
  const categoryTarget = await categories.first().getAttribute("href");
  expect(firstName).not.toBe("");
  expect(categoryTarget).toMatch(/^#/u);

  await search.fill(firstName.slice(0, 160));
  await expect(products.first().getByRole("heading", { level: 3 })).toHaveText(firstName);
  await search.fill("qa-" + crypto.randomUUID());
  await expect(products).toHaveCount(0);
  await expect(categories).toHaveCount(0);
  await search.fill("");
  await expect(products).toHaveCount(productCount);
  await expect(categories).toHaveCount(categoryCount);
  await expect(categories.first()).toHaveAttribute("href", categoryTarget!);
}
