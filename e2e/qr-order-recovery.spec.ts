import { expect, test, type Page } from "@playwright/test";

const takeoutQrToken = "demo-aming-chicken-qr-2026-rotate-me";
const password = "StallOrderDemo!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=|\/staff\//);
}

test("重掃同一 QR 找回原訂單，遺失三位數取餐碼時可人工核對", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const customerName = `重掃 QA ${Date.now()}`;
  await page.goto(`/q/${takeoutQrToken}`);
  await page.getByRole("button", { name: "點餐語言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  const chickenCutlet = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet", exact: true }),
  });
  await chickenCutlet.getByRole("button", { name: "Increase Deep-Fried Chicken Cutlet" }).click();
  await chickenCutlet.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.getByLabel("Customer name").fill(customerName);
  await expect(page.getByRole("button", { name: "Place order", exact: true })).toBeEnabled({ timeout: 15_000 });

  const createResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);
  const orderNumberText = await page.getByText(/^訂單 /).textContent();
  const orderNo = orderNumberText?.replace(/^訂單\s*/, "") ?? "";
  expect(orderNo).not.toBe("");
  const trackingPath = new URL(page.url()).pathname;

  const resumeResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-order-session")
    && response.request().method() === "POST"
  ));
  await page.goto(`/q/${takeoutQrToken}`);
  expect((await resumeResponse).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).pathname).toBe(trackingPath);
  await expect(page.getByTestId("pickup-code")).toHaveText(/^\d{3}$/);

  const staffContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  try {
    const staffPage = await staffContext.newPage();
    await login(staffPage, "staff@stallorder.test");
    await staffPage.goto("/staff/aming-chicken");
    const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
    await staffOrder.getByRole("button", { name: "確認接單" }).click();
    await staffOrder.getByRole("button", { name: "全部開始製作（1）", exact: true }).click();
    await staffOrder.getByRole("button", { name: "全部餐點完成（1）", exact: true }).click();
    await expect(staffOrder.getByLabel("三位數取餐碼")).toBeVisible();
    await staffOrder.getByRole("button", { name: "無法取得取餐碼" }).click();

    const manualDialog = staffPage.getByRole("alertdialog", { name: "人工核對取餐" });
    await expect(manualDialog).toContainText(`訂單 ${orderNo}`);
    await expect(manualDialog.getByLabel("輸入完整訂單編號以確認")).toHaveCount(0);
    const confirmManualPickup = manualDialog.getByRole("button", { name: "確認人工取餐" });
    await expect(confirmManualPickup).toBeDisabled();
    await manualDialog.getByLabel("已向顧客核對稱呼與全部餐點內容").check();
    await expect(confirmManualPickup).toBeEnabled();
    const manualPickupRequest = staffPage.waitForRequest((request) => (
      new URL(request.url()).pathname.endsWith("/verify-pickup")
      && request.method() === "POST"
    ));
    await confirmManualPickup.click();
    expect((await manualPickupRequest).postDataJSON()).toMatchObject({
      mode: "MANUAL",
      confirmationOrderNo: orderNo,
      confirmedCustomerDetails: true,
    });
    await expect(staffOrder).toContainText("已完成人工取餐核對");
  } finally {
    await staffContext.close();
  }
});
