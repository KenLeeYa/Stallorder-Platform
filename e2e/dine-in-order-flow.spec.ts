import { expect, test, type Page } from "@playwright/test";

const password = "StallOrderDemo!2026";
const tableQrToken = "demo-aming-chicken-table-a1-qr-2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const loginResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/auth/login")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/merchant\/dashboard|\/staff\//);
}

test("內用桌位從 QR 點餐連動廚房、出餐與折扣結帳", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const customerName = `內用 QA ${Date.now()}`;
  await page.goto(`/q/${tableQrToken}`);
  await expect(page.getByText("內用 · A1 桌", { exact: true }).filter({ visible: true })).toBeVisible();

  await page.getByRole("button", { name: "點餐語言" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet" })).toBeVisible();
  await page.getByRole("button", { name: "Increase Deep-Fried Chicken Cutlet" }).click();
  await page.getByRole("button", { name: "Increase Sweet Potato Fries" }).click();
  await page.getByLabel("Customer name").fill(customerName);
  await expect(page.getByRole("button", { name: "Place order", exact: true })).toBeEnabled({ timeout: 15_000 });

  const createResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText("內用桌位", { exact: true })).toBeVisible();
  await expect(page.getByText("A1 桌", { exact: true })).toBeVisible();
  await expect(page.getByText("取餐驗證碼", { exact: true })).toHaveCount(0);

  const staffContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 390, height: 844 },
  });
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@stallorder.test");
  await staffPage.goto("/staff/aming-chicken");
  await expect(staffPage.getByRole("switch", { name: /新訂單提醒/ })).toBeVisible();
  await staffPage.getByPlaceholder("搜尋桌號、訂單編號或顧客").filter({ visible: true }).fill("A1");
  const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
  await expect(staffOrder).toContainText("內用 · A1 桌");
  await staffOrder.getByRole("button", { name: "確認接單" }).click();
  await expect(staffOrder).toContainText("已確認");

  const kitchenContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  const kitchenPage = await kitchenContext.newPage();
  await login(kitchenPage, "kitchen@stallorder.test");
  await kitchenPage.goto("/staff/aming-chicken");
  const kitchenOrder = kitchenPage.getByRole("article").filter({ hasText: customerName });
  await kitchenPage.getByRole("button", { name: "同品項彙總" }).click();
  await expect(kitchenPage.getByText(/來源：.*A1 桌/).first()).toBeVisible();
  await kitchenPage.getByRole("button", { name: "訂單票" }).click();
  const selectableItems = kitchenOrder.getByRole("checkbox", { name: /選取/ });
  await expect(selectableItems).toHaveCount(2);
  await selectableItems.nth(0).check();
  await selectableItems.nth(1).check();
  await kitchenPage.getByRole("button", { name: "批次開始製作", exact: true }).click();
  await kitchenPage.getByRole("button", { name: "復原", exact: true }).click();
  await expect(kitchenPage.getByText("已復原上一筆批次餐點操作。")).toBeVisible();
  await kitchenOrder.getByRole("button", { name: "全部開始製作（2）", exact: true }).click();
  await expect(kitchenOrder).toContainText("製作中");
  await kitchenOrder.getByRole("button", { name: "全部餐點完成（2）", exact: true }).click();
  await expect(kitchenOrder).toContainText("已完成餐點");
  await expect(kitchenOrder.getByRole("button", { name: "標記已出餐" })).toHaveCount(0);
  await expect(kitchenOrder.getByRole("button", { name: /全部標記已出餐/ })).toHaveCount(0);

  await expect(staffOrder).toContainText("已完成餐點", { timeout: 10_000 });
  await staffPage.getByRole("link", { name: "桌位平面圖" }).click();
  await expect(staffPage).toHaveURL(/\/staff\/aming-chicken\/floor/);
  await expect(staffPage.getByRole("region", { name: "內用桌位平面" })).toBeVisible();
  await staffPage.getByRole("button", { name: /^A1 桌，/ }).click();
  const tableDetail = staffPage.getByRole("region", { name: "A1 桌" });
  await expect(tableDetail).toContainText(customerName);
  const tableOrder = tableDetail.locator("article").filter({ hasText: customerName });
  await tableOrder.getByRole("button", { name: "全部標記已出餐（2）", exact: true }).click();
  await expect(tableOrder.getByText("已出餐", { exact: true })).toHaveCount(2);
  expect(await staffPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await staffPage.getByRole("link", { name: "訂單看板" }).click();
  await expect(staffPage).toHaveURL(/\/staff\/aming-chicken$/);
  await expect(staffOrder.getByText("已出餐", { exact: true })).toHaveCount(2);
  await expect(staffOrder.getByLabel("三位數取餐碼")).toHaveCount(0);
  await staffOrder.getByRole("button", { name: "完成訂單" }).click();

  const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
  await expect(checkout.getByRole("button", { name: "LINE Pay" })).toBeVisible();
  await expect(checkout.getByRole("button", { name: "街口支付" })).toBeVisible();
  await checkout.getByRole("button", { name: "9 折" }).click();
  await checkout.getByRole("button", { name: "$500" }).click();
  await expect(checkout).toContainText("$135");
  await expect(checkout).toContainText("$365");
  await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
  await expect(staffOrder).toHaveCount(0);

  await staffPage.goto("/staff/aming-chicken/floor");
  const cleaningTable = staffPage.getByRole("button", { name: /A1 桌，待清潔/ });
  await expect(cleaningTable).toBeVisible({ timeout: 10_000 });
  await cleaningTable.click();
  await staffPage.getByRole("button", { name: "清潔完成，設為空桌" }).click();
  await expect(staffPage.getByRole("button", { name: /A1 桌，空桌/ })).toBeVisible();

  await page.getByRole("button", { name: "重新整理訂單" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已付款", { exact: true })).toBeVisible();
  await expect(page.getByText("已出餐", { exact: true })).toHaveCount(2);

  await kitchenContext.close();
  await staffContext.close();
});
