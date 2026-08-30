import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { derivePublicOrderTokens } from "../supabase/functions/_shared/crypto";
import { dismissStaffStartReminder } from "./local-navigation";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const stallSlug = "aming-chicken";
const qrToken = "demo-aming-chicken-qr-2026-rotate-me";
const password = "StallOrderDemo!2026";
const runMarker = `單店員 KDS 列印 QA ${Date.now()}-${randomUUID().slice(0, 8)}`;
const printerName = `${runMarker} 印表機`;

let product: { id: string; name: string };
let cashPaymentOptionId = "";
let activeCashShiftId = "";
let createdCashShiftId = "";
let createdPrinterId = "";
let originalSettings: { kdsModuleEnabled: boolean; printModuleEnabled: boolean };
const temporarilyDisabledPrinterIds: string[] = [];
const createdOrderIds: string[] = [];
const createdClosureIds: string[] = [];

test.describe("單店員 KDS／列印分流與公休公告", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [settings, cashOption, staff, openShift, selectedProduct] = await Promise.all([
      prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId },
        select: { kdsModuleEnabled: true, printModuleEnabled: true },
      }),
      prisma.paymentOption.findUniqueOrThrow({
        where: { stallId_code: { stallId, code: "CASH" } },
        select: { id: true, isEnabled: true },
      }),
      prisma.profile.findUniqueOrThrow({
        where: { email: "staff@stallorder.test" },
        select: { id: true },
      }),
      prisma.cashShift.findFirst({
        where: { organizationId, stallId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      }),
      prisma.product.findFirstOrThrow({
        where: {
          organizationId,
          isActive: true,
          stallProducts: { some: { stallId, isEnabled: true, isSoldOut: false } },
        },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      }),
    ]);

    originalSettings = settings;
    expect(cashOption.isEnabled).toBe(true);
    cashPaymentOptionId = cashOption.id;
    product = selectedProduct;

    if (openShift) {
      activeCashShiftId = openShift.id;
    } else {
      const shift = await prisma.cashShift.create({
        data: {
          organizationId,
          stallId,
          openingAmount: 0,
          openedById: staff.id,
          note: runMarker,
        },
        select: { id: true },
      });
      activeCashShiftId = shift.id;
      createdCashShiftId = shift.id;
    }

    const printer = await prisma.printer.create({
      data: {
        organizationId,
        stallId,
        name: printerName,
        isEnabled: false,
      },
      select: { id: true },
    });
    createdPrinterId = printer.id;
  });

  test.afterAll(async () => {
    try {
      if (createdClosureIds.length > 0) {
        await prisma.stallSpecialClosure.deleteMany({ where: { id: { in: createdClosureIds } } });
      }
      if (createdOrderIds.length > 0) {
        await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
      }
      if (createdPrinterId) {
        await prisma.printer.deleteMany({ where: { id: createdPrinterId } });
      }
      if (temporarilyDisabledPrinterIds.length > 0) {
        await prisma.printer.updateMany({
          where: { id: { in: temporarilyDisabledPrinterIds } },
          data: { isEnabled: true },
        });
      }
      if (createdCashShiftId) {
        await prisma.cashShiftReview.deleteMany({ where: { cashShiftId: createdCashShiftId } });
        await prisma.cashMovement.deleteMany({ where: { cashShiftId: createdCashShiftId } });
        await prisma.cashShift.deleteMany({ where: { id: createdCashShiftId } });
      }
    } finally {
      try {
        if (originalSettings) {
          await prisma.stallOrderingSettings.update({
            where: { stallId },
            data: originalSettings,
          });
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  test("KDS 與列印皆關閉時，店員結帳一次即完成且不建立隱藏工作", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const ownerContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    try {
      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, "owner@stallorder.test", /\/merchant\/dashboard/);
      await setModule(ownerPage, "kds", "廚房 KDS", "kdsModuleEnabled", false);
      await expect.poll(() => prisma.orderProductionTask.count({
        where: { stallId, status: { in: ["PENDING", "PREPARING"] } },
      })).toBe(0);
      await setModule(ownerPage, "printing", "訂單列印", "printModuleEnabled", false);
      await expect.poll(() => prisma.printJob.count({
        where: { stallId, status: { in: ["PENDING", "PRINTING"] } },
      })).toBe(0);
      await expect.poll(() => prisma.order.count({
        where: {
          stallId,
          status: "READY",
          paymentStatus: "PAID",
          externalProvider: null,
          OR: [
            { source: { not: "QR_MENU" } },
            { fulfillmentType: { not: "TAKEOUT" } },
            { pickupVerifiedAt: { not: null } },
          ],
        },
      })).toBe(0);

      await ownerPage.goto(`/merchant/stalls/${stallId}`);
      await expect(ownerPage.getByRole("link", { name: "廚房 KDS", exact: true })).toBeVisible();
      await expect(ownerPage.getByRole("link", { name: "KDS 工作站", exact: true })).toHaveCount(0);
      await expect(ownerPage.getByRole("link", { name: "KDS 設定", exact: true })).toHaveCount(0);

      await ownerPage.goto(`/staff/${stallSlug}`);
      await dismissStaffStartReminder(ownerPage);
      const visibleHeader = ownerPage.locator('[data-testid="staff-sticky-header"]:visible').last();
      const workMode = visibleHeader.getByTestId("work-mode-icon-staff").locator("..");
      await expect(workMode).toBeVisible();
      await workMode.click();
      const workModeDialog = ownerPage.getByRole("dialog", { name: "切換工作模式" });
      await expect(workModeDialog).toBeVisible();
      await expect(workModeDialog.getByTestId("compact-switcher-option").filter({ hasText: /^廚房/u })).toHaveCount(0);
      await workModeDialog.getByRole("button", { name: "關閉", exact: true }).click();

      for (const viewport of [
        { width: 320, height: 568, name: "mobile" },
        { width: 768, height: 1024, name: "tablet" },
        { width: 1440, height: 900, name: "desktop" },
      ]) {
        await ownerPage.setViewportSize(viewport);
        const header = ownerPage.locator('[data-testid="staff-sticky-header"]:visible').last();
        const functions = header.locator('[data-testid="staff-function-grid"]:visible');
        await expect(header).toBeVisible();
        await expect(functions).toBeVisible();
        expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
        expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

        const hitTargets = await functions.locator("button, a").evaluateAll((elements) => elements
          .map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              label: element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent?.trim() ?? "",
              className: element.getAttribute("class") ?? "",
              width: bounds.width,
              height: bounds.height,
            };
          })
          .filter((target) => target.width > 0 && target.height > 0));
        expect(hitTargets.length).toBeGreaterThan(4);
        expect(
          hitTargets.filter(({ width, height }) => width < 40 || height < 40),
          `${viewport.name} 工具列包含小於 40px 的點擊區`,
        ).toEqual([]);

        if (viewport.width === 768) {
          const groupRows = await functions.locator(":scope > *").evaluateAll((elements) => (
            elements.map((element) => element.getBoundingClientRect().y)
          ));
          expect(groupRows.every((y) => Math.abs(y - groupRows[0]!) <= 1)).toBe(true);
        }
        await ownerPage.screenshot({
          path: testInfo.outputPath(`staff-toolbar-${viewport.name}.png`),
          fullPage: false,
        });
      }

      await ownerPage.goto(`/kitchen?stall=${stallSlug}`);
      await expect(ownerPage.getByRole("heading", { name: "找不到此頁面", exact: true })).toBeVisible();
    } finally {
      await ownerContext.close();
    }

    const order = await createConfirmedOrder(`${runMarker} 無列印`);
    expect(await prisma.printJob.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.orderProductionTask.count({ where: { orderId: order.id } })).toBe(0);

    const staffContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: { width: 390, height: 844 },
    });
    try {
      const staffPage = await staffContext.newPage();
      await login(staffPage, "staff@stallorder.test", new RegExp(`/staff/${stallSlug}`));
      await staffPage.goto(`/staff/${stallSlug}`);
      await dismissStaffStartReminder(staffPage);
      const ticket = staffPage.getByRole("article").filter({ hasText: order.customerName });
      await expect(ticket).toBeVisible();
      await expect(ticket.getByRole("button", { name: /開始製作|餐點完成/u })).toHaveCount(0);
      await ticket.getByRole("button", { name: "代結帳", exact: true }).click();

      const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
      await checkout.getByRole("button", { name: "現金", exact: true }).click();
      const responsePromise = waitForOrderPatch(staffPage, order.id);
      await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toMatchObject({
        status: "COMPLETED",
        paymentOptionId: cashPaymentOptionId,
        cashReceived: order.total,
      });
      await expect(response.json()).resolves.toMatchObject({ completionPendingPrint: false });
      await expect(ticket).toHaveCount(0);

      const completed = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true, payment: true, printJobs: true, productionTasks: true },
      });
      expect(completed).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID" });
      expect(completed.items.map((item) => item.status)).toEqual(["READY"]);
      expect(completed.payment).toMatchObject({
        paymentOptionId: cashPaymentOptionId,
        cashShiftId: activeCashShiftId,
        status: "PAID",
      });
      expect(completed.printJobs).toHaveLength(0);
      expect(completed.productionTasks).toHaveLength(0);
    } finally {
      await staffContext.close();
    }
  });

  test("KDS 關閉時，Menu 外帶單由店員完成並自動通知顧客可取餐", async ({ browser }) => {
    test.setTimeout(120_000);
    const order = await createConfirmedPublicOrder(`${runMarker} 顧客取餐通知`);
    expect(await prisma.printJob.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.orderProductionTask.count({ where: { orderId: order.id } })).toBe(0);

    const customerContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: { width: 390, height: 844 },
    });
    const staffContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: { width: 390, height: 844 },
    });
    try {
      await customerContext.addInitScript((deviceId) => {
        document.cookie = `stallorder_device=${encodeURIComponent(deviceId)}; Path=/; SameSite=Lax`;
        window.localStorage.setItem("stallorder_device:v1", JSON.stringify({
          id: deviceId,
          expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1_000),
        }));
      }, order.deviceId);
      const customerPage = await customerContext.newPage();
      await customerPage.goto(`/order/${order.trackingToken}`);
      await expect(customerPage.getByText("攤位已確認", { exact: true }).first()).toBeVisible();

      const staffPage = await staffContext.newPage();
      await login(staffPage, "staff@stallorder.test", new RegExp(`/staff/${stallSlug}`));
      await staffPage.goto(`/staff/${stallSlug}`);
      await dismissStaffStartReminder(staffPage);
      const ticket = staffPage.getByRole("article").filter({ hasText: order.customerName });
      const finishAndNotify = ticket.getByRole("button", {
        name: "餐點完成・通知可取餐",
        exact: true,
      });
      await expect(finishAndNotify).toBeVisible();
      const readyResponsePromise = waitForOrderPatch(staffPage, order.id);
      await finishAndNotify.click();
      const readyResponse = await readyResponsePromise;
      expect(readyResponse.status()).toBe(200);
      expect(readyResponse.request().postDataJSON()).toMatchObject({ status: "READY" });

      await expect.poll(async () => prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true, items: { select: { status: true } } },
      })).toEqual({ status: "READY", items: [{ status: "READY" }] });

      const readyDialog = customerPage.getByRole("dialog", { name: "餐點已可取餐" });
      await expect(readyDialog).toBeVisible({ timeout: 20_000 });
      await expect(readyDialog.getByTestId("pickup-ready-dialog-code")).toHaveText(order.pickupCode);
    } finally {
      await Promise.all([customerContext.close(), staffContext.close()]);
    }
  });

  test("KDS 關閉但列印開啟時，確認即排入列印且收款後成功自動結單", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const ownerContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    try {
      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, "owner@stallorder.test", /\/merchant\/dashboard/);
      await setModule(ownerPage, "printing", "訂單列印", "printModuleEnabled", true);
    } finally {
      await ownerContext.close();
    }

    const competingPrinters = await prisma.printer.findMany({
      where: { stallId, id: { not: createdPrinterId }, isEnabled: true },
      select: { id: true },
    });
    temporarilyDisabledPrinterIds.push(...competingPrinters.map((printer) => printer.id));
    await prisma.$transaction([
      prisma.printer.updateMany({
        where: { id: { in: temporarilyDisabledPrinterIds } },
        data: { isEnabled: false },
      }),
      prisma.printer.update({
        where: { id: createdPrinterId },
        data: { isEnabled: true, lastSeenAt: new Date() },
      }),
    ]);
    const order = await createConfirmedOrder(`${runMarker} 列印自動完成`);
    const queuedOnConfirmation = await prisma.printJob.findMany({
      where: { orderId: order.id },
      select: { status: true, printerId: true },
    });
    expect(queuedOnConfirmation).toEqual([{
      status: "PENDING",
      printerId: createdPrinterId,
    }]);
    expect(await prisma.orderProductionTask.count({ where: { orderId: order.id } })).toBe(0);

    const staffContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
      viewport: { width: 390, height: 844 },
    });
    try {
      const staffPage = await staffContext.newPage();
      await staffPage.addInitScript(() => {
        window.print = () => {
          const key = "stallorder-qa-print-count";
          window.sessionStorage.setItem(key, String(Number(window.sessionStorage.getItem(key) ?? "0") + 1));
        };
      });
      await login(staffPage, "staff@stallorder.test", new RegExp(`/staff/${stallSlug}`));
      await staffPage.goto(`/staff/${stallSlug}`);
      await dismissStaffStartReminder(staffPage);
      const ticket = staffPage.getByRole("article").filter({ hasText: order.customerName });
      await expect(ticket).toBeVisible();
      await ticket.getByRole("button", { name: "代結帳", exact: true }).click();
      const checkout = staffPage.getByRole("dialog", { name: "完成訂單" });
      await checkout.getByRole("button", { name: "現金", exact: true }).click();
      const checkoutResponsePromise = waitForOrderPatch(staffPage, order.id);
      await checkout.getByRole("button", { name: "完成訂單", exact: true }).click();
      const checkoutResponse = await checkoutResponsePromise;
      expect(checkoutResponse.status()).toBe(200);
      await expect(checkoutResponse.json()).resolves.toMatchObject({ completionPendingPrint: true });
      await expect(ticket.getByText("已收款，列印完成後自動結單", { exact: true })).toBeVisible();
      await expect(ticket.getByRole("button", { name: "代結帳", exact: true })).toHaveCount(0);
      await expect(ticket.getByRole("button", { name: "完成此桌", exact: true })).toHaveCount(0);
      await staffPage.screenshot({ path: testInfo.outputPath("staff-waiting-for-print.png"), fullPage: true });

      const pending = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true, payment: true, printJobs: true, productionTasks: true },
      });
      expect(pending).toMatchObject({ status: "READY", paymentStatus: "PAID" });
      expect(pending.items.map((item) => item.status)).toEqual(["READY"]);
      expect(pending.printJobs).toHaveLength(1);
      expect(pending.printJobs[0]).toMatchObject({ status: "PENDING", printerId: createdPrinterId });
      expect(pending.productionTasks).toHaveLength(0);

      await staffPage.goto(`/staff/${stallSlug}/print`);
      const printer = staffPage.getByRole("article").filter({
        hasText: printerName,
        has: staffPage.getByRole("button", { name: "本機接手", exact: true }),
      });
      await expect(printer).toBeVisible();
      await printer.getByRole("button", { name: "本機接手", exact: true }).click();
      const printJob = staffPage.getByRole("article").filter({ hasText: order.orderNo });
      await expect(printJob).toContainText("待列印");
      const startPrint = printJob.getByRole("button", { name: "開始列印", exact: true });
      await expect(startPrint).toBeEnabled();
      const claimResponsePromise = waitForPrintCommand(staffPage, "CLAIM");
      await startPrint.click();
      expect((await claimResponsePromise).status()).toBe(200);
      await expect.poll(() => staffPage.evaluate(() => window.sessionStorage.getItem("stallorder-qa-print-count"))).toBe("1");

      const success = printJob.getByRole("button", { name: "成功", exact: true });
      await expect(success).toBeVisible();
      const successResponsePromise = waitForPrintCommand(staffPage, "SUCCESS");
      await success.click();
      expect((await successResponsePromise).status()).toBe(200);
      await expect(printJob).toContainText("列印成功");
      await expect.poll(async () => {
        const state = await prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { status: true, completedAt: true, printJobs: { select: { status: true } } },
        });
        return { status: state.status, completed: state.completedAt !== null, printStatus: state.printJobs[0]?.status };
      }).toEqual({ status: "COMPLETED", completed: true, printStatus: "SUCCEEDED" });
      await staffPage.screenshot({ path: testInfo.outputPath("print-success-auto-complete.png"), fullPage: true });

      await staffPage.goto(`/staff/${stallSlug}`);
      await dismissStaffStartReminder(staffPage);
      await expect(staffPage.getByRole("article").filter({ hasText: order.customerName })).toHaveCount(0);
    } finally {
      await staffContext.close();
    }
  });

  test("單日公休同步顯示於公開 Menu 與 QR，且顧客無法下單", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const today = taipeiDate();
    const closureTitle = `${runMarker} 今日公休`;
    const closureMessage = "設備保養，明日恢復營業。";
    const ownerContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
    try {
      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, "owner@stallorder.test", /\/merchant\/dashboard/);
      await ownerPage.goto(`/merchant/stalls/${stallId}/settings/special-hours`);
      await ownerPage.getByLabel("公休日期", { exact: true }).fill(today);
      await ownerPage.getByLabel("公告標題").fill(closureTitle);
      await ownerPage.getByLabel("補充說明（選填）").fill(closureMessage);
      const createResponsePromise = waitForClosureCommand(ownerPage, "CREATE");
      await ownerPage.getByRole("button", { name: "新增公休公告", exact: true }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(200);
      const createPayload = await createResponse.json() as { closures: Array<{ id: string; title: string }> };
      const closureId = createPayload.closures.find((closure) => closure.title === closureTitle)?.id;
      expect(closureId).toEqual(expect.any(String));
      createdClosureIds.push(closureId!);
      await expect(ownerPage.getByRole("article").filter({ hasText: closureTitle })).toBeVisible();

      const customerContext = await browser.newContext({
        locale: "zh-TW",
        timezoneId: "Asia/Taipei",
        viewport: { width: 390, height: 844 },
      });
      try {
        const customerPage = await customerContext.newPage();
        await customerPage.goto("/store/aming-01?view=menu");
        const publicBanner = customerPage.getByTestId("public-menu-special-closure");
        await expect(publicBanner).toContainText(closureTitle);
        await expect(publicBanner).toContainText(closureMessage);
        await expect(customerPage.getByRole("main")).toContainText(product.name);

        await customerPage.goto(`/q/${qrToken}`);
        const qrMain = customerPage.locator("main:visible").last();
        const qrBanner = qrMain.getByTestId("qr-special-closure");
        await expect(qrBanner).toContainText(closureTitle);
        await expect(qrBanner).toContainText(closureMessage);
        const increaseProduct = qrMain.getByRole("button", { name: `增加 ${product.name}`, exact: true });
        await expect(increaseProduct).toBeDisabled();
        await expect(qrMain.getByTestId("qr-mobile-cart-summary")).toHaveCount(0);
        await expect(customerPage.locator("[data-nextjs-dialog]")).toHaveCount(0);
        await customerPage.screenshot({ path: testInfo.outputPath("qr-special-closure-mobile.png"), fullPage: true });
      } finally {
        await customerContext.close();
      }

      const closureArticle = ownerPage.getByRole("article").filter({ hasText: closureTitle });
      ownerPage.once("dialog", (dialog) => void dialog.accept());
      const deleteResponsePromise = waitForClosureCommand(ownerPage, "DELETE");
      await closureArticle.getByTitle("刪除公休公告").click();
      expect((await deleteResponsePromise).status()).toBe(200);
      await expect(closureArticle).toHaveCount(0);
      createdClosureIds.splice(createdClosureIds.indexOf(closureId!), 1);
    } finally {
      await ownerContext.close();
    }
  });
});

async function createConfirmedOrder(customerName: string) {
  const unique = randomUUID();
  const order = await prisma.order.create({
    data: {
      organizationId,
      stallId,
      orderNo: `QA-${Date.now().toString().slice(-7)}-${unique.slice(0, 4)}`,
      trackingTokenHash: createHash("sha256").update(`tracking-${unique}`).digest("hex"),
      idempotencyKey: randomUUID(),
      source: "STAFF_POS",
      origin: "ONLINE_STAFF",
      isTest: false,
      customerName,
      fulfillmentType: "TAKEOUT",
      status: "CONFIRMED",
      paymentStatus: "UNPAID",
      subtotal: 95,
      total: 95,
      deviceHash: createHash("sha256").update(`device-${unique}`).digest("hex"),
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000),
      confirmedAt: new Date(),
      items: {
        create: {
          organizationId,
          stallId,
          productId: product.id,
          name: product.name,
          baseUnitPrice: 95,
          unitPrice: 95,
          quantity: 1,
          status: "PENDING",
        },
      },
    },
    select: { id: true, orderNo: true, customerName: true, total: true },
  });
  createdOrderIds.push(order.id);
  return order;
}

async function createConfirmedPublicOrder(customerName: string) {
  const orderId = randomUUID();
  const deviceId = randomUUID();
  const { trackingToken, pickupCode } = await derivePublicOrderTokens(
    orderId,
    requiredTokenDerivationSecret(),
  );
  const order = await prisma.order.create({
    data: {
      id: orderId,
      organizationId,
      stallId,
      orderNo: `QR-${Date.now().toString().slice(-7)}-${orderId.slice(0, 4)}`,
      trackingTokenHash: createHash("sha256").update(trackingToken).digest("hex"),
      idempotencyKey: randomUUID(),
      source: "QR_MENU",
      isTest: true,
      customerName,
      customerPhone: "0912345678",
      fulfillmentType: "TAKEOUT",
      status: "CONFIRMED",
      paymentStatus: "UNPAID",
      subtotal: 95,
      total: 95,
      deviceHash: createHmac("sha256", requiredAbuseHashSecret())
        .update(`device:${deviceId}`)
        .digest("hex"),
      pickupCodeHash: createHash("sha256").update(pickupCode).digest("hex"),
      pickupCodeDisplay: pickupCode,
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000),
      confirmedAt: new Date(),
      items: {
        create: {
          organizationId,
          stallId,
          productId: product.id,
          name: product.name,
          baseUnitPrice: 95,
          unitPrice: 95,
          quantity: 1,
          status: "PENDING",
        },
      },
    },
    select: { id: true, customerName: true },
  });
  createdOrderIds.push(order.id);
  return { ...order, trackingToken, pickupCode, deviceId };
}

function requiredAbuseHashSecret() {
  const secret = process.env.ABUSE_HASH_SECRET;
  if (!secret) throw new Error("E2E 測試需要設定 ABUSE_HASH_SECRET。");
  return secret;
}

function requiredTokenDerivationSecret() {
  const secret = process.env.TOKEN_DERIVATION_SECRET;
  if (!secret) throw new Error("E2E 測試需要設定 TOKEN_DERIVATION_SECRET。");
  return secret;
}

async function setModule(
  page: Page,
  section: "kds" | "printing",
  label: string,
  field: "kdsModuleEnabled" | "printModuleEnabled",
  enabled: boolean,
) {
  await page.goto(`/merchant/stalls/${stallId}/settings/${section}`);
  const control = page.getByRole("switch", { name: new RegExp(label, "u") });
  await expect(control).toBeVisible();
  const expected = String(enabled);
  if (await control.getAttribute("aria-checked") !== expected) await control.click();
  const responsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/api/merchant/stalls/${stallId}/modules`)
    && response.request().method() === "PATCH"
  ));
  await page.getByRole("button", { name: "儲存設定", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toMatchObject({
    operation: "UPDATE_MODULES",
    view: section,
    [field]: enabled,
  });
  await expect(control).toHaveAttribute("aria-checked", expected);
  await expect.poll(async () => (
    await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { [field]: true } })
  )[field]).toBe(enabled);
}

async function login(page: Page, email: string, destination: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const responsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page).toHaveURL(destination, { timeout: 30_000 });
}

function waitForOrderPatch(page: Page, orderId: string) {
  return page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/orders/${orderId}`)
    && response.request().method() === "PATCH"
  ));
}

function waitForPrintCommand(page: Page, operation: string) {
  return page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/api/stalls/${stallSlug}/print-jobs`)
    && response.request().method() === "POST"
    && requestOperation(response) === operation
  ));
}

function waitForClosureCommand(page: Page, operation: string) {
  return page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith(`/api/merchant/stalls/${stallId}/special-closures`)
    && response.request().method() === "PATCH"
    && requestOperation(response) === operation
  ));
}

function requestOperation(response: Response) {
  try {
    return (response.request().postDataJSON() as { operation?: string } | null)?.operation;
  } catch {
    return undefined;
  }
}

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 測試需要設定 DATABASE_URL。");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`拒絕對非本機資料庫執行 E2E：${hostname}`);
  }
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(
      process.env.STALLORDER_E2E_ENV_FILE ?? resolve(process.cwd(), ".env"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] = value.replace(/^(["'])(.*)\1$/u, "$2");
  }
}
