import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { dismissStaffStartReminder, qrProductSelectionControl } from "../local-navigation";
import { createResponsiveOrderFixture } from "../helpers/responsive-order-fixture";

assertResponsiveQaTarget(process.env);

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

async function prepareDirtyPos(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByTestId("staff-product-card").filter({ hasText: productName })
    .getByTestId("staff-open-product-configurator").click();
  const modifier = page.getByTestId("staff-product-configurator");
  await modifier.getByRole("radio", { name: /QA 必選加料/ }).click();
  await modifier.getByRole("button", { name: "加入購物車", exact: true }).click();
  await dialog.getByTestId("staff-order-cart-tab").click();
  const line = dialog.getByTestId("staff-cart-line").filter({ hasText: productName });
  await line.getByRole("button", { name: new RegExp(`^增加 ${productName}`) }).click();
  await expect(line).toContainText(`2 × ${productName}`);
  await dialog.getByTestId("staff-tablet-confirm-order").click();
  await dialog.getByTestId("staff-checkout-note-button").click();
  const note = page.getByRole("dialog", { name: "整單備註" });
  await note.getByRole("textbox").fill("A2 保留的整單備註");
  await note.getByRole("button", { name: "儲存", exact: true }).click();
}

async function expectDirtyPosRetained(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("staff-checkout-back-icon").click();
  const line = dialog.getByTestId("staff-cart-line").filter({ hasText: productName });
  await expect(line).toContainText(`2 × ${productName}`);
  await expect(line).toContainText("QA 必選加料");
  await dialog.getByTestId("staff-tablet-confirm-order").click();
  await dialog.getByTestId("staff-checkout-note-button").click();
  const note = page.getByRole("dialog", { name: "整單備註" });
  await expect(note.getByRole("textbox")).toHaveValue("A2 保留的整單備註");
  await note.getByRole("button", { name: "儲存", exact: true }).click();
}

for (const closeMethod of ["Escape", "close button"] as const) {
  test(`dirty POS ${closeMethod} confirms discard and preserves draft on cancel`, async ({ page }) => {
    const { trigger, dialog } = await openPos(page);
    await prepareDirtyPos(page, dialog);
    const messages: string[] = [];
    let accept = false;
    page.on("dialog", async (confirmation) => {
      messages.push(confirmation.message());
      if (accept) await confirmation.accept();
      else await confirmation.dismiss();
    });
    const close = async () => {
      if (closeMethod === "Escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "關閉店員點餐", exact: true }).click();
    };
    await close();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("放棄");
    await expectDirtyPosRetained(page, dialog);
    accept = true;
    await close();
    expect(messages).toHaveLength(2);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("nested modifier Escape closes only top layer", async ({ page }) => {
  const { dialog } = await openPos(page);
  const productTrigger = dialog.getByTestId("staff-product-card").filter({ hasText: productName })
    .getByTestId("staff-open-product-configurator");
  await productTrigger.click();
  const modifier = page.getByTestId("staff-product-configurator");
  await expect(modifier).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modifier).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(productTrigger).toBeFocused();
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

test("workspace all functions closes once and restores its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard\?organizationId=/);
  const trigger = page.getByRole("button", { name: "所有功能", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "所有功能", exact: true });
  await expect(dialog.getByRole("heading", { name: "所有功能", exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
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
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(customization).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(customization).toBeHidden();
  await expect(trigger).toBeFocused();
});
