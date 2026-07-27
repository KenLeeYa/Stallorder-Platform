import { expect, test } from "@playwright/test";

test("首頁以攤點通與商家營運資訊呈現", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "攤點通" })).toBeVisible();
  await expect(page.getByText("從顧客 QR Code 點餐、店員接單、廚房出餐到付款與銷售報表，協助商家用手機掌握現場營運，快速完成每日開店與結帳。")).toBeVisible();
  await expect(page.getByText("每個商戶的商品、訂單與銷售報表皆獨立隔離。")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const heading = document.querySelector("h1");
    const headingRect = heading?.getBoundingClientRect();
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      headingWithinViewport: Boolean(
        headingRect
        && headingRect.left >= 0
        && headingRect.right <= window.innerWidth,
      ),
    };
  });
  expect(mobileLayout).toEqual({
    noHorizontalOverflow: true,
    headingWithinViewport: true,
  });
});
