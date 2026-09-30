import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  addFirstStaffCatalogProduct,
  dismissStaffStartReminder,
  gotoLocalPath,
  loginLocalTestAccount,
} from "./local-navigation";

test.use({ serviceWorkers: "block" });

for (const width of [320, 390, 768, 1024]) {
  test(`POS ${width}px 核對份數、總額、實收與找零後才提交`, async ({ page }) => {
    await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
    await page.setViewportSize({ width, height: 844 });
    await gotoLocalPath(page, "/staff/aming-chicken");
    await dismissStaffStartReminder(page);
    await page.getByRole("button", { name: "店員點餐", exact: true }).click();
    const pos = page.getByRole("dialog", { name: "店員點餐", exact: true });
    await addFirstStaffCatalogProduct(page, pos);
    if (width < 768) await pos.getByTestId("staff-order-cart-tab").click();
    const total = pos.getByTestId("staff-cart-live-total");
    await expect(total).toContainText("1 份");
    await expect(total.locator("strong")).toContainText("$");
    await pos.getByTestId("staff-tablet-confirm-order").click();
    const cashRow = pos.getByTestId("staff-checkout-cash-row");
    const quick = cashRow.getByTestId("cash-quick-amounts");
    const input = cashRow.getByRole("textbox");
    await input.fill("10000");
    await expect(input).toHaveValue("10000");
    expect(await input.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const button of await quick.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const change = pos.getByTestId("cash-change-summary");
    await expect(change).toContainText("應找零");
    await expect(change.locator("strong")).toBeVisible();
    await input.fill("1");
    await expect(change).toContainText("尚差");
    await expect(change.locator("strong")).toBeVisible();
    const submit = pos.getByRole("button", { name: "建立訂單並收款", exact: true });
    const submitBox = await submit.boundingBox();
    expect(submitBox!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("列印失敗只重試列印工作，不重送已完成的 POS 收款", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  const stallId = "22222222-2222-4222-8222-222222222222";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  let orderId = "";
  let jobId = "";
  let printWasEnabled: boolean | null = null;
  let orderPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/stalls/aming-chicken/orders") orderPosts += 1;
  });
  try {
    await loginLocalTestAccount(page, "staff@stallorder.test", "StallOrderDemo!2026");
    const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId }, select: { printModuleEnabled: true },
    });
    printWasEnabled = settings.printModuleEnabled;
    await prisma.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: false } });
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLocalPath(page, "/staff/aming-chicken");
    await dismissStaffStartReminder(page);
    await page.getByRole("button", { name: "店員點餐", exact: true }).click();
    const pos = page.getByRole("dialog", { name: "店員點餐", exact: true });
    await addFirstStaffCatalogProduct(page, pos);
    await pos.getByTestId("staff-order-cart-tab").click();
    await pos.getByTestId("staff-tablet-confirm-order").click();
    const create = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/stalls/aming-chicken/orders"
      && response.request().method() === "POST"
    ));
    await pos.getByRole("button", { name: "建立訂單並收款", exact: true }).click();
    const response = await create;
    expect(response.status()).toBe(201);
    const payload = await response.json() as { order: { id: string; orderNo: string } };
    orderId = payload.order.id;
    await expect(pos).toBeHidden();
    expect(orderPosts).toBe(1);
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    expect(await prisma.printJob.count({ where: { orderId } })).toBe(0);
    await prisma.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: true } });
    jobId = (await prisma.printJob.create({ data: {
      organizationId, stallId, orderId, status: "FAILED", attemptCount: 1,
      lastError: "A4 synthetic printer offline",
    }, select: { id: true } })).id;
    expect(await prisma.printJob.findMany({
      where: { orderId }, select: { id: true, status: true, lastError: true },
    })).toEqual([{ id: jobId, status: "FAILED", lastError: "A4 synthetic printer offline" }]);
    await gotoLocalPath(page, "/staff/aming-chicken/print");
    const job = page.locator("article")
      .filter({ hasText: payload.order.orderNo })
      .filter({ hasText: "A4 synthetic printer offline" });
    await expect(job).toHaveCount(1);
    await expect(job).toContainText(payload.order.orderNo);
    const retry = page.waitForResponse((res) => (
      new URL(res.url()).pathname === "/api/stalls/aming-chicken/print-jobs"
      && res.request().method() === "POST"
      && res.request().postDataJSON()?.operation === "RETRY"
    ));
    await job.getByRole("button", { name: "重試", exact: true }).click();
    expect((await retry).status()).toBe(200);
    await expect.poll(async () => (await prisma.printJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } })).status).toBe("PENDING");
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
    expect(orderPosts).toBe(1);
  } finally {
    if (jobId) await prisma.printJob.deleteMany({ where: { id: jobId } });
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    if (printWasEnabled !== null) await prisma.stallOrderingSettings.update({
      where: { stallId }, data: { printModuleEnabled: printWasEnabled },
    });
    await prisma.$disconnect();
  }
});
