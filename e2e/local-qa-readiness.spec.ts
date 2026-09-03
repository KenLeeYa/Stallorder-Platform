import { expect, test } from "@playwright/test";

const quickLoginDestinations = [
  ["商家", /\/merchant\/dashboard\?organizationId=/],
  ["店員", /\/staff\/aming-chicken/],
  ["廚房", /\/kitchen\?stall=aming-chicken/],
  ["平台管理者", /\/admin\/billing$/],
] as const;

test.skip(
  process.env.LOCAL_QA_READINESS !== "true",
  "Only the explicit local QA readiness command may exercise development quick login.",
);

for (const [role, destination] of quickLoginDestinations) {
  test(`本機快速登入：${role}`, async ({ page }) => {
    await page.goto("/login");
    const grid = page.getByTestId("local-qa-login-grid");
    await expect(grid).toBeVisible();

    const responsePromise = page.waitForResponse((response) => (
      response.url().endsWith("/api/auth/login")
      && response.request().method() === "POST"
    ));
    await grid.getByRole("button", { name: role, exact: true }).click();

    expect((await responsePromise).status()).toBe(200);
    await expect(page).toHaveURL(destination);
  });
}

test("本機公開 Menu、QR、外帶自取與現金交班可實際操作", async ({ page }) => {
  test.setTimeout(180_000);
  const menuResponse = await page.goto("/store/aming-01?view=menu");
  expect(menuResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);

  for (const path of [
    "/q/demo-aming-chicken-qr-2026-rotate-me",
    "/store/aming-01?view=pickup",
  ]) {
    const sessionResponse = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && ["/create-order-session", "/api/public/order-session"].some((suffix) => (
        new URL(response.url()).pathname.endsWith(suffix)
      ))
    ));
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect((await sessionResponse).status()).toBeLessThan(300);
    await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);
    await expect(page.getByText("線上送單暫時停用", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeVisible();
  }

  await page.goto("/login");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "店員", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/aming-chicken/);
  const cashResponse = await page.goto("/staff/aming-chicken/cash");
  expect(cashResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "發生錯誤", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "現金交班與對帳", exact: true })).toBeVisible();
});
