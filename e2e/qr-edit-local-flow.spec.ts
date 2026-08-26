import { expect, test } from "@playwright/test";

const qrToken = "demo-aming-chicken-qr-2026-rotate-me";

test("本機 QR 外帶可全天候下單並透過同站服務載入修改訂單", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const sessionResponse = page.waitForResponse((response) => (
    ["/create-order-session", "/api/public/order-session"].some((path) => (
      new URL(response.url()).pathname.endsWith(path)
    ))
    && response.request().method() === "POST"
  ));
  await page.goto(`/q/${qrToken}`);
  expect((await sessionResponse).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();

  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await product.getByRole("button", { name: "增加 香酥雞排" }).click();
  await product.getByRole("button", { name: "加入購物車", exact: true }).click();
  await page.getByTestId("qr-mobile-cart-summary").click();
  const cart = page.getByTestId("qr-cart-panel");
  await cart.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
  await page.getByLabel("顧客稱呼").fill("本機修改流程 QA");
  await page.getByLabel("聯絡電話").fill("0912345678");
  const waitAcknowledgment = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/u });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

  const createResponsePromise = page.waitForResponse((response) => (
    ["/create-public-order", "/api/public/orders"].some((path) => (
      new URL(response.url()).pathname.endsWith(path)
    ))
    && response.request().method() === "POST"
  ));
  const submit = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  const createResponse = await createResponsePromise;
  expect([200, 201]).toContain(createResponse.status());
  await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+$/u);
  const trackingToken = new URL(page.url()).pathname.split("/").at(-1);
  expect(trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/u);

  const prepareResponsePromise = page.waitForResponse((response) => (
    [
      "/functions/v1/prepare-reorder",
      `/api/public/orders/${trackingToken}/reorder`,
    ].some((path) => new URL(response.url()).pathname.endsWith(path))
    && response.request().method() === "POST"
  ));
  await page.getByRole("link", { name: "修改訂單", exact: true }).click();
  const prepareResponse = await prepareResponsePromise;
  expect(prepareResponse.status()).toBe(200);
  const preparePath = new URL(prepareResponse.url()).pathname;
  if (preparePath.endsWith(`/api/public/orders/${trackingToken}/reorder`)) {
    expect(prepareResponse.headers()["x-order-circuit"]).toBe("B");
  } else {
    expect(preparePath).toBe("/functions/v1/prepare-reorder");
  }
  await expect(page.getByRole("heading", { name: "修改訂單", exact: true })).toBeVisible();
  await expect(page.getByText("香酥雞排", { exact: false })).toBeVisible();
  await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.getByRole("button", { name: "前往目前菜單修改", exact: true }).click();
  await expect(page).toHaveURL(/\/store\/aming-01\?/u);
  const editUrl = new URL(page.url());
  expect(editUrl.searchParams.get("view")).toBe("pickup");
  expect(editUrl.searchParams.get("editOrder")).toMatch(/^sto_[A-Za-z0-9_-]+$/u);
  await expect(page.getByRole("heading", { name: "阿明鹽酥雞", exact: true })).toBeVisible();
});
