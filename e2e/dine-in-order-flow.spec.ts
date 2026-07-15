import { expect, test, type Page } from "@playwright/test";

const password = "StallOrderDemo!2026";
const tableQrToken = "demo-aming-chicken-table-a1-qr-2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard|\/staff\//);
}

test("內用桌位從 QR 點餐連動廚房、出餐與折扣結帳", async ({ browser, page }) => {
  const customerName = `內用 QA ${Date.now()}`;
  await page.goto(`/q/${tableQrToken}`);
  await expect(page.getByText("內用 · A1 桌", { exact: true })).toBeVisible();

  await page.getByLabel("商品語言").selectOption("en");
  await expect(page.getByRole("heading", { name: "Crispy Chicken Cutlet" })).toBeVisible();
  await page.getByRole("button", { name: "增加 Crispy Chicken Cutlet" }).click();
  await page.getByLabel("顧客稱呼").fill(customerName);
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeEnabled({ timeout: 15_000 });

  const createResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "送出訂單", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText("內用桌位", { exact: true })).toBeVisible();
  await expect(page.getByText("A1 桌", { exact: true })).toBeVisible();
  await expect(page.getByText("取餐驗證碼", { exact: true })).toHaveCount(0);

  const staffContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
  await expect(staffOrder).toContainText("內用 · A1 桌");
  await staffOrder.getByRole("button", { name: "確認接單" }).click();
  await expect(staffOrder).toContainText("已確認");

  const kitchenContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const kitchenPage = await kitchenContext.newPage();
  await login(kitchenPage, "kitchen@stallorder.test");
  await kitchenPage.goto("/staff/aming-chicken");
  const kitchenOrder = kitchenPage.getByRole("article").filter({ hasText: customerName });
  await kitchenOrder.getByRole("button", { name: "開始製作" }).click();
  await expect(kitchenOrder).toContainText("製作中");
  await kitchenOrder.getByRole("button", { name: "餐點完成" }).click();
  await expect(kitchenOrder).toContainText("已完成餐點");
  await expect(kitchenOrder.getByRole("button", { name: "標記已出餐" })).toHaveCount(0);

  await expect(staffOrder).toContainText("已完成餐點", { timeout: 10_000 });
  await staffOrder.getByRole("button", { name: "標記已出餐" }).click();
  await expect(staffOrder).toContainText("已出餐");
  await expect(staffOrder.getByLabel("六位數取餐碼")).toHaveCount(0);
  await staffOrder.getByRole("button", { name: "完成訂單" }).click();

  const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
  await expect(checkout.getByRole("button", { name: "LINE Pay" })).toBeVisible();
  await expect(checkout.getByRole("button", { name: "街口支付" })).toBeVisible();
  await checkout.getByRole("button", { name: "9 折" }).click();
  await checkout.getByRole("button", { name: "$500" }).click();
  await expect(checkout).toContainText("$86");
  await expect(checkout).toContainText("$414");
  await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
  await expect(staffOrder).toHaveCount(0);

  await page.getByRole("button", { name: "重新整理訂單" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已付款", { exact: true })).toBeVisible();
  await expect(page.getByText("已出餐", { exact: true })).toBeVisible();

  await kitchenContext.close();
  await staffContext.close();
});
