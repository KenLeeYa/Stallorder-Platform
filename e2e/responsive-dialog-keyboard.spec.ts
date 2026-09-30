import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { dismissStaffStartReminder, qrProductSelectionControl } from "./local-navigation";
import { createResponsiveOrderFixture } from "./helpers/responsive-order-fixture";

test.use({ serviceWorkers: "block" });

let productName: string;
let qrToken: string;

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    productName = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
    qrToken = fixture.qrToken;
  } finally {
    await prisma.$disconnect();
  }
});

async function openPos(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("staff@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  const trigger = page.getByRole("button", { name: "店員點餐", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "店員點餐", exact: true });
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

test("empty POS closes once and restores trigger", async ({ page }) => {
  const { trigger, dialog } = await openPos(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("nested modifier Escape closes only top layer", async ({ page }) => {
  const { dialog } = await openPos(page);
  await dialog.getByTestId("staff-product-card").filter({ hasText: productName })
    .getByTestId("staff-open-product-configurator").click();
  const modifier = page.getByTestId("staff-product-configurator");
  await expect(modifier).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modifier).toBeHidden();
  await expect(dialog).toBeVisible();
});

test("pending submission rejects Escape and close", async ({ page }) => {
  const { dialog } = await openPos(page);
  await dialog.getByTestId("staff-product-card").filter({ hasText: productName })
    .getByTestId("staff-open-product-configurator").click();
  const modifier = page.getByTestId("staff-product-configurator");
  await modifier.getByRole("radio", { name: /QA 必選加料/ }).click();
  await modifier.getByRole("button", { name: "加入購物車", exact: true }).click();
  await dialog.getByTestId("staff-order-cart-tab").click();
  await dialog.getByTestId("staff-tablet-confirm-order").click();
  await dialog.getByRole("button", { name: "稍後結帳", exact: true }).click();

  let submitRequests = 0;
  let releaseRequest!: () => void;
  const heldRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/api/stalls/aming-chicken/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    submitRequests += 1;
    requestStarted();
    await heldRequest;
    await route.continue();
  });
  try {
    await dialog.getByRole("button", { name: "建立訂單送入廚房", exact: true }).click();
    await started;
    await page.keyboard.press("Escape");
    const close = dialog.getByRole("button", { name: "關閉店員點餐", exact: true });
    await expect(close).toBeDisabled();
    await expect(dialog).toBeVisible();
    expect(submitRequests).toBe(1);
  } finally {
    releaseRequest();
  }
});

test("Tab never leaves active dialog", async ({ page }) => {
  const { dialog } = await openPos(page);
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByTestId("staff-product-card").filter({ hasText: productName })
    .getByTestId("staff-open-product-configurator").click();
  const modifier = page.getByTestId("staff-product-configurator");
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    expect(await modifier.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
});

test("Staff search and all functions keep one accessible entry", async ({ page }) => {
  const { dialog } = await openPos(page);
  await dialog.getByRole("button", { name: "關閉店員點餐", exact: true }).click();
  await expect(dialog).toBeHidden();
  const searchTrigger = page.getByTestId("staff-search-open");
  await searchTrigger.click();
  const search = page.getByRole("dialog", { name: "搜尋桌號或訂單編號", exact: true });
  await expect(search).toBeVisible();
  await expect(search.getByRole("heading", { name: "搜尋桌號或訂單編號" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(searchTrigger).toBeFocused();
  const allFunctions = page.getByTestId("staff-tools-toggle");
  await allFunctions.click();
  await expect(allFunctions).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("staff-function-grid")).toBeVisible();
  await allFunctions.click();
  await expect(allFunctions).toHaveAttribute("aria-expanded", "false");
});

test("QR customization keeps its heading and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/q/${qrToken}`);
  const product = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName, exact: true }),
  });
  const trigger = qrProductSelectionControl(product, productName);
  await trigger.click();
  const customization = page.getByTestId("qr-product-configuration");
  await expect(customization).toBeVisible();
  await expect(customization.getByRole("heading", { name: productName, exact: true })).toHaveCount(1);
  await customization.getByRole("button", { name: "關閉", exact: true }).click();
  await expect(customization).toBeHidden();
  expect(await product.evaluate((element) => ({
    active: document.activeElement?.tagName,
    activeId: document.activeElement?.id,
    triggerFound: Boolean(element.querySelector('[data-testid="qr-open-product-configurator"]')),
    triggerFocused: document.activeElement === element.querySelector('[data-testid="qr-open-product-configurator"]'),
  }))).toMatchObject({ triggerFound: true, triggerFocused: true });
});
