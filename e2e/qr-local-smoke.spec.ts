import { expect, test } from "@playwright/test";

const demoQrToken = "demo-aming-chicken-qr-2026-rotate-me";

test("手機 QR 點餐使用固定訂單摘要且不產生水平溢位", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sessionResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-order-session")
    && response.request().method() === "POST"
  ));

  await page.goto(`/q/${demoQrToken}`);
  expect((await sessionResponse).status()).toBe(201);

  const firstProduct = page.getByRole("article").first();
  await firstProduct.locator('button[title]:not([disabled])').first().click();

  const summary = page.getByTestId("qr-mobile-cart-summary");
  await expect(summary).toBeVisible();
  expect((await summary.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await summary.click();
  const cart = page.getByTestId("qr-cart-panel");
  await expect(cart).toHaveAttribute("role", "dialog");
  await expect(cart.locator('input[type="text"]')).toHaveAttribute("maxlength", "50");
  await expect(cart.locator("textarea").last()).toHaveAttribute("maxlength", /^\d+$/);
});

test("本機 QA 可透過示範 QR 建立點餐 session", async ({ page }) => {
  const sessionResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-order-session")
    && response.request().method() === "POST"
  ));

  await page.goto(`/q/${demoQrToken}`);

  const response = await sessionResponse;
  expect(response.status()).toBe(201);
  const session = await response.json();
  expect(session.estimatedWaitMinMinutes).toBeGreaterThanOrEqual(0);
  expect(session.estimatedWaitMaxMinutes).toBeGreaterThanOrEqual(session.estimatedWaitMinMinutes);
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  const waitText = session.estimatedWaitMinMinutes === session.estimatedWaitMaxMinutes
    ? `目前預估等候約 ${session.estimatedWaitMaxMinutes} 分鐘`
    : `目前預估等候時間：${session.estimatedWaitMinMinutes}～${session.estimatedWaitMaxMinutes} 分鐘`;
  await expect(page.getByText(waitText, { exact: true })).toBeVisible();
  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await expect(product).toContainText("95");
  await product.getByRole("button", { name: "增加 香酥雞排" }).click();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeEnabled({ timeout: 15_000 });

  const restoredSession = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-order-session")
    && response.request().method() === "POST"
  ));
  await page.reload();
  expect((await restoredSession).status()).toBe(201);
  await expect(page.getByText("已恢復上次尚未送出的點餐內容。")).toBeVisible();
  await expect(page.getByTestId("qr-cart-panel").getByText("共 1 份")).toBeVisible();
});
