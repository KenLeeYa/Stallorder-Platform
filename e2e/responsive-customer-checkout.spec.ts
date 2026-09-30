import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { continueQrCheckout, qrProductSelectionControl } from "./local-navigation";
import { createResponsiveOrderFixture } from "./helpers/responsive-order-fixture";

test.use({ actionTimeout: 15_000, serviceWorkers: "block" });

async function addConfiguredCopy(page: Page, productName: string) {
  const product = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName, exact: true }),
  });
  await qrProductSelectionControl(product, productName).click();
  const configurator = page.getByTestId("qr-product-configuration");
  await expect(configurator.getByRole("button", { name: "加入購物車", exact: true })).toBeDisabled();
  await configurator.getByRole("radio", { name: /QA 必選加料/ }).click();
  await configurator.getByRole("checkbox", { name: /QA 可選加料/ }).click();
  await configurator.getByRole("button", { name: "加入購物車", exact: true }).click();
}

test("guest customizations keep server total through rotation", async ({ page }) => {
  test.setTimeout(180_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    const name = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
    const createdOrderIds: string[] = [];
    const sessionStatuses: number[] = [];
    page.on("response", async (response) => {
      const path = new URL(response.url()).pathname;
      if (path === "/functions/v1/create-order-session" && response.request().method() === "POST") {
        sessionStatuses.push(response.status());
      }
      if (path === "/functions/v1/create-public-order" && response.status() === 201) {
        const payload = await response.json() as { orderId?: string };
        if (payload.orderId) createdOrderIds.push(payload.orderId);
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/q/${fixture.qrToken}`);
    await addConfiguredCopy(page, name);
    await addConfiguredCopy(page, name);
    const cartSummary = page.getByTestId("qr-mobile-cart-summary");
    await expect(cartSummary).toContainText("130");
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(cartSummary).toBeVisible();
    await cartSummary.click();
    await expect(page.getByTestId("qr-cart-panel")).toContainText("130");
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.getByTestId("qr-cart-panel")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(cartSummary).toBeVisible();
    await cartSummary.click();
    await page.getByTestId("qr-cart-panel").getByRole("button", { name: "繼續填寫訂購資料" }).click();
    await continueQrCheckout(page);
    const acknowledge = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
    if (await acknowledge.isVisible()) await acknowledge.check();
    const submitted = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/functions/v1/create-public-order"
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "送出訂單", exact: true }).click();
    expect((await submitted).status()).toBe(201);
    expect(sessionStatuses).toContain(201);
    await expect(page).toHaveURL(/\/order\/[^/]+$/);
    const trackingToken = new URL(page.url()).pathname.slice("/order/".length);
    const storedOrder = await prisma.order.findUniqueOrThrow({
      where: { trackingTokenHash: createHash("sha256").update(trackingToken).digest("hex") },
      include: { items: true },
    });
    expect(storedOrder.total).toBe(130);
    expect(storedOrder.items.reduce((n, item) => n + item.quantity, 0)).toBe(2);
    expect(new Set(createdOrderIds).size).toBe(1);
    await page.reload();
    await expect(page.getByTestId("pickup-code")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/order\/[^/]+$/);
  } finally {
    await prisma.$disconnect();
  }
});

test("menu pickup navigation reaches usable cart", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    await prisma.stallOrderingSettings.update({
      where: { stallId: fixture.stallId },
      data: { takeoutPreorderEnabled: true },
    });
    const stall = await prisma.stall.findUniqueOrThrow({
      where: { id: fixture.stallId },
      select: { code: true },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/store/${stall.code}?view=menu`);
    await expect(page.getByTestId("storefront-menu-view")).toBeVisible();
    await page.locator('[data-testid="storefront-mode-nav"] a[href*="view=pickup"]').click();
    await expect(page).toHaveURL(new RegExp(`/store/${stall.code}\\?view=pickup`));
    await expect(page.getByRole("heading", { name: `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}` })).toBeVisible();
    await expect(page.getByTestId("qr-cart-panel")).toBeHidden();
    await expect(page.getByTestId("storefront-mode-nav").locator('a[aria-current="page"]')).toContainText("外帶");
  } finally {
    await prisma.$disconnect();
  }
});

test("last item and validation stay above sticky footer", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    const name = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 640 });
      await page.goto(`/q/${fixture.qrToken}`);
      const product = page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await qrProductSelectionControl(product, name).click();
      const configurator = page.getByTestId("qr-product-configuration");
      const submit = configurator.getByRole("button", { name: "加入購物車", exact: true });
      await expect(submit).toBeDisabled();
      const requiredMessage = configurator.getByRole("status");
      await expect(requiredMessage).toBeVisible();
      await configurator.locator("footer button").first().click();
      const lastOption = configurator.getByRole("checkbox", { name: /QA 可選加料/ });
      await lastOption.scrollIntoViewIfNeeded();
      const optionBox = await lastOption.boundingBox();
      const footerBox = await configurator.locator("footer").boundingBox();
      expect(optionBox && footerBox && optionBox.y + optionBox.height <= footerBox.y).toBe(true);
      await expect(submit).toBeDisabled();
      await configurator.getByRole("radio", { name: /QA 必選加料/ }).click();
      await expect(submit).toBeEnabled();
      await configurator.getByRole("button", { name: "關閉", exact: true }).click();
    }
  } finally {
    await prisma.$disconnect();
  }
});
