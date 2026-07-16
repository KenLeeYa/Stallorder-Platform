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
  await expect(page.getByText(/目前預估等候約 15 分鐘/)).toBeVisible();
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
  await expect(page.getByText("共 1 份")).toBeVisible();
});
