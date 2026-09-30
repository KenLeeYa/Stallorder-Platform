import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { continueQrCheckout, qrProductSelectionControl } from "../local-navigation";
import { createResponsiveOrderFixture } from "../helpers/responsive-order-fixture";
import { waitForOwnedOrderRateWindow } from "../helpers/responsive-order-rate-window";
import { createResponsiveQaClient } from "../../scripts/responsive-qa-target.mjs";

assertResponsiveQaTarget(process.env);

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
    const createdTrackingTokens: string[] = [];
    const sessionStatuses: number[] = [];
    page.on("response", async (response) => {
      const path = new URL(response.url()).pathname;
      if (path === "/functions/v1/create-order-session" && response.request().method() === "POST") {
        sessionStatuses.push(response.status());
      }
      if (path === "/functions/v1/create-public-order" && response.status() === 201) {
        const payload = await response.json() as { trackingToken?: string };
        if (payload.trackingToken) createdTrackingTokens.push(payload.trackingToken);
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
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByTestId("qr-cart-panel")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(cartSummary).toBeVisible();
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
    await expect.poll(() => createdTrackingTokens.length).toBe(1);
    const createdOrderIds = await Promise.all(createdTrackingTokens.map(async (token) => (
      await prisma.order.findUniqueOrThrow({
        where: { trackingTokenHash: createHash("sha256").update(token).digest("hex") },
        select: { id: true },
      })
    ).id));
    expect(new Set(createdOrderIds).size).toBe(1);
    const otherDevice = await page.request.get(`/api/public/orders/${trackingToken}`, {
      headers: {
        "x-stallorder-protocol-version": "1",
        "x-stallorder-operation-id": randomUUID(),
        "x-stallorder-device-id": randomUUID(),
      },
    });
    expect([403, 404]).toContain(otherDevice.status());
    const isOriginalOrder = () => new URL(page.url()).pathname === `/order/${trackingToken}`;
    await page.reload();
    await expect(page.getByTestId("pickup-code")).toBeVisible();
    await expect.poll(isOriginalOrder).toBe(true);
    await page.goBack();
    await expect.poll(isOriginalOrder).toBe(true);
  } finally {
    await prisma.$disconnect();
  }
});

test("menu pickup navigation reaches usable cart", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = createResponsiveQaClient(process.env, () => new PrismaClient());
  const stallId = randomUUID();
  const stallSlug = `b3-pickup-${stallId.slice(0, 8)}`;
  try {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { email: "owner@stallorder.test" },
      select: { id: true },
    });
    await prisma.stall.create({ data: {
      id: stallId, organizationId: organization.id, name: "B3 pickup isolated stall",
      slug: stallSlug, code: stallSlug, address: "Synthetic local QA",
      location: "Synthetic local QA", isActive: true, businessStatus: "OPEN",
      orderingState: "OPEN", orderingEnabled: true,
    } });
    await prisma.stallBusinessHour.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      organizationId: organization.id, stallId, dayOfWeek,
      opensAt: "00:00", closesAt: "00:00", isClosed: false,
    })) });
    await prisma.stallOrderingSettings.create({ data: {
      organizationId: organization.id, stallId, kdsModuleEnabled: true,
      printModuleEnabled: false, paymentModuleEnabled: true, enabledLocales: ["zh-TW"],
    } });
    await prisma.paymentOption.create({ data: {
      organizationId: organization.id, stallId, code: "CASH", name: "現金", kind: "CASH",
    } });
    const fixture = await createResponsiveOrderFixture(prisma, stallSlug);
    await prisma.stallOrderingSettings.update({
      where: { stallId: fixture.stallId },
      data: { takeoutPreorderEnabled: true },
    });
    const stall = await prisma.stall.findUniqueOrThrow({
      where: { id: fixture.stallId },
      select: { code: true },
    });
    const sessionProductIds: string[][] = [];
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname === "/functions/v1/create-order-session"
        && response.request().method() === "POST" && response.status() === 201) {
        const body = await response.json() as { products?: Array<{ id: string }> };
        sessionProductIds.push((body.products ?? []).map((product) => product.id));
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/store/${stall.code}?view=menu`);
    await expect(page.getByTestId("storefront-menu-view")).toBeVisible();
    await page.locator('[data-testid="storefront-mode-nav"] a[href*="view=pickup"]').click();
    await expect(page).toHaveURL(new RegExp(`/store/${stall.code.toLowerCase()}\\?view=pickup`));
    const pickupDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));
    const fields = page.getByTestId("qr-preorder-fulfillment-time-fields");
    await fields.getByLabel("預約取餐日期").fill(pickupDate);
    await fields.getByLabel("預約取餐時間－時").selectOption("12");
    await fields.getByLabel("預約取餐時間－分").selectOption("00");
    const apply = page.getByRole("button", { name: "套用這個時間", exact: true });
    if (await apply.isVisible()) await apply.click();
    await expect(page.getByRole("button", { name: "時間已套用", exact: true })).toBeVisible();
    await expect.poll(() => sessionProductIds.length).toBeGreaterThan(0);
    expect(sessionProductIds.some((ids) => ids.includes(fixture.productId))).toBe(true);
    const fixtureProduct = page.locator(`article#qr-product-${fixture.productId}`).getByRole("heading", { name: `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`, exact: true });
    await expect(fixtureProduct).toBeVisible();
    await addConfiguredCopy(page, `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`);
    await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("65");
    await expect(page.getByTestId("storefront-mode-nav").locator('a[aria-current="page"]')).toContainText("外帶");
  } finally {
    try {
      const stall = await prisma.stall.findUnique({ where: { id: stallId }, select: { slug: true } });
      if (stall) {
        expect(stall.slug).toBe(stallSlug);
        await prisma.cashShiftReview.deleteMany({ where: { cashShift: { stallId } } });
        await prisma.cashMovement.deleteMany({ where: { cashShift: { stallId } } });
        await prisma.cashShift.deleteMany({ where: { stallId } });
        await prisma.billingStallUsageSummary.deleteMany({ where: { stallId } });
        await prisma.stall.delete({ where: { id: stallId } });
      }
    } finally {
      await prisma.$disconnect();
    }
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

test("stale sold-out item preserves remaining cart", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    const category = await prisma.productCategory.findFirstOrThrow({
      where: { organizationId: fixture.organizationId, isActive: true }, select: { id: true },
    });
    const remainingName = `有效餐 ${fixture.runId.slice(0, 8)}`;
    await prisma.product.create({ data: {
      organizationId: fixture.organizationId,
      categoryId: category.id,
      name: remainingName,
      description: "隔離本機購物車恢復測試",
      defaultPrice: 40,
      kind: "SINGLE",
      isActive: true,
      stallProducts: { create: {
        organizationId: fixture.organizationId,
        stallId: fixture.stallId,
        isEnabled: true,
        isSoldOut: false,
        stockRemaining: 100,
      } },
    } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/q/${fixture.qrToken}`);
    await addConfiguredCopy(page, `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`);
    const remaining = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: remainingName, exact: true }),
    });
    await remaining.getByRole("button", { name: `增加 ${remainingName}` }).click();
    await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("105");
    await prisma.stallProduct.updateMany({
      where: { stallId: fixture.stallId, productId: fixture.productId },
      data: { isSoldOut: true },
    });
    await page.reload();
    await expect(page.getByTestId("qr-mobile-cart-summary")).toContainText("40");
    await page.getByTestId("qr-mobile-cart-summary").click();
    await expect(page.getByTestId("qr-cart-lines")).toContainText(remainingName);
    await expect(page.getByTestId("qr-cart-lines")).not.toContainText(`跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`);
  } finally {
    await prisma.$disconnect();
  }
});

test("unavailable session explains recovery before ordering", async ({ page }) => {
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    await page.route("**/functions/v1/create-order-session", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "SESSION_EXPIRED" }) });
    });
    await page.goto(`/q/${fixture.qrToken}`);
    await expect(page.getByRole("alertdialog")).toContainText("點餐工作階段已失效，請重新掃描 QR Code。");
    await expect(page.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
    await page.unroute("**/functions/v1/create-order-session");
    await page.reload();
    await expect(page.getByRole("heading", { name: `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}` })).toBeVisible();
  } finally {
    await prisma.$disconnect();
  }
});

test("no available session keeps ordering disabled and recovers after connection returns", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  try {
    const fixture = await createResponsiveOrderFixture(prisma);
    let edgeFailures = 0;
    let nodeFailures = 0;
    await page.route("**/functions/v1/create-order-session", async (route) => {
      edgeFailures += 1;
      await route.abort("failed");
    });
    await page.route("**/api/public/order-session", async (route) => {
      nodeFailures += 1;
      await route.abort("failed");
    });
    await page.goto(`/q/${fixture.qrToken}`);
    await expect(page.getByRole("alertdialog")).toContainText("網路連線中斷，請稍後再試。");
    expect(edgeFailures).toBeGreaterThan(0);
    expect(nodeFailures).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeDisabled();
    await page.unroute("**/functions/v1/create-order-session");
    await page.unroute("**/api/public/order-session");
    await page.reload();
    await expect(page.getByRole("heading", { name: `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}` })).toBeVisible();
  } finally {
    await prisma.$disconnect();
  }
});

for (const failure of [
  { name: "401 session rejection", status: 401, body: { code: "SESSION_EXPIRED" }, expected: "點餐工作階段已失效" },
  { name: "422 sold-out rejection", status: 422, body: { code: "PRODUCT_UNAVAILABLE" }, expected: "部分商品已售完" },
  { name: "HTML 500 from both intake paths", status: 500, body: null, expected: "目前無法送出訂單" },
] as const) {
  test(`${failure.name} preserves cart and recovers through the original submit`, async ({ page }, testInfo) => {
    test.setTimeout(450_000);
    const prisma = new PrismaClient();
    const issuedSessionRequestIds: string[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/functions/v1/create-order-session"
        && response.request().method() === "POST" && response.status() === 201) {
        const requestId = response.headers()["x-request-id"];
        if (requestId) issuedSessionRequestIds.push(requestId);
      }
    });
    try {
      const fixture = await createResponsiveOrderFixture(prisma);
      const name = `跨裝置 QA 餐 ${fixture.runId.slice(0, 8)}`;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/q/${fixture.qrToken}`);
      await addConfiguredCopy(page, name);
      await page.getByTestId("qr-mobile-cart-summary").click();
      await page.getByTestId("qr-cart-panel").getByRole("button", { name: "繼續填寫訂購資料" }).click();
      await continueQrCheckout(page);
      const acknowledge = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/ });
      if (await acknowledge.isVisible()) await acknowledge.check();
      let edgeFailures = 0;
      let nodeFailures = 0;
      const fail = async (route: import("@playwright/test").Route, path: "edge" | "node") => {
        if (path === "edge") edgeFailures += 1;
        else nodeFailures += 1;
        await route.fulfill({
          status: failure.status,
          contentType: failure.body ? "application/json" : "text/html",
          body: failure.body ? JSON.stringify(failure.body) : "<html><body>server failure</body></html>",
        });
      };
      await page.route("**/functions/v1/create-public-order", (route) => fail(route, "edge"));
      await page.route("**/api/public/orders", (route) => fail(route, "node"));
      await page.getByRole("button", { name: "送出訂單", exact: true }).click();
      const feedback = page.getByRole("alertdialog").filter({ hasText: failure.expected });
      await expect(feedback).toBeVisible();
      expect(edgeFailures + nodeFailures).toBeGreaterThan(0);
      if (!failure.body) expect(nodeFailures).toBeGreaterThan(0);
      await expect(page.getByTestId("qr-cart-panel")).toContainText("65");
      await feedback.getByRole("button", { name: "關閉" }).click();
      await page.unroute("**/functions/v1/create-public-order");
      await page.unroute("**/api/public/orders");
      const sessionRequestId = issuedSessionRequestIds.at(-1);
      expect(sessionRequestId).toBeTruthy();
      const rateWindow = await waitForOwnedOrderRateWindow(prisma, fixture.stallId, sessionRequestId!);
      console.info(JSON.stringify({ event: "responsive_order_rate_preflight", phase: failure.name, ...rateWindow }));
      await testInfo.attach("order-rate-window-before-recovery", {
        body: Buffer.from(JSON.stringify(rateWindow)), contentType: "application/json",
      });
      await page.getByRole("button", { name: "送出訂單", exact: true }).click();
      await expect(page).toHaveURL(/\/order\/[^/]+$/);
      const trackingToken = new URL(page.url()).pathname.slice("/order/".length);
      const storedOrder = await prisma.order.findUniqueOrThrow({
        where: { trackingTokenHash: createHash("sha256").update(trackingToken).digest("hex") },
        select: { total: true },
      });
      expect(storedOrder.total).toBe(65);
    } finally {
      await prisma.$disconnect();
    }
  });
}
