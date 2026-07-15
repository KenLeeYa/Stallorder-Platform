import { expect, test } from "@playwright/test";

const demoQrToken = "demo-aming-chicken-qr-2026-rotate-me";

test("本機 QA 可透過示範 QR 建立點餐 session", async ({ page }) => {
  const sessionResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-order-session")
    && response.request().method() === "POST"
  ));

  await page.goto(`/q/${demoQrToken}`);

  expect((await sessionResponse).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await expect(product).toContainText("95");
  await product.getByRole("button", { name: "增加 香酥雞排" }).click();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeEnabled({ timeout: 15_000 });
});
