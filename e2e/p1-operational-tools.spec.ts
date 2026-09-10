import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import {
  continueQrCheckout,
  dismissStaffStartReminder,
  qrProductSelectionControl,
} from "./local-navigation";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const password = "StallOrderDemo!2026";
const organizationId = "11111111-1111-4111-8111-111111111111";
const primaryStallId = randomUUID();
const primaryStallSlug = "p1-operations-" + primaryStallId.slice(0, 8);
const tableQrToken = "p1-table-" + primaryStallId;
const managerAuthorizationCode = "246810";
const sourceSlug = "p1-template-source";
const targetSlug = "p1-template-target";
let sourceStallId = "";
let targetStallId = "";
let highDiscountId = "";
let additionalStallApprovalId = "";
let originalManagerAuthorizationCodeHash: string | null = null;
let originalPrimaryBusinessHours: Array<{
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}> = [];
const createdOrderIds: string[] = [];

test.describe("P1 營運功能", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await prisma.stall.create({ data: {
      id: primaryStallId, organizationId, slug: primaryStallSlug, code: primaryStallSlug,
      name: "同桌合併與列印 QA", address: "本機", location: "本機",
      orderingEnabled: true, orderingState: "OPEN", businessStatus: "OPEN",
      orderingSettings: { create: { organizationId, dineInEnabled: true, paymentModuleEnabled: true,
        discountModuleEnabled: true, printModuleEnabled: true, kdsModuleEnabled: true } },
      paymentOptions: { create: { organizationId, code: "CASH", name: "現金", kind: "CASH" } },
      businessHours: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        organizationId, dayOfWeek, opensAt: "00:00", closesAt: "00:00",
      })) },
    } });
    const members = await prisma.stallMembership.findMany({
      where: { stallId: "22222222-2222-4222-8222-222222222222", isActive: true },
      select: { profileId: true, role: true },
    });
    await prisma.stallMembership.createMany({
      data: members.map((member) => ({ ...member, organizationId, stallId: primaryStallId })),
    });
    const menu = await prisma.product.findMany({
      where: { organizationId, name: { in: ["香酥雞排", "地瓜薯條"] } },
    });
    await prisma.stallProduct.createMany({
      data: menu.map((product) => ({ organizationId, stallId: primaryStallId, productId: product.id })),
    });
    const table = await prisma.diningTable.create({ data: {
      organizationId, stallId: primaryStallId, code: "A1", label: "A1 桌",
    } });
    await prisma.qrCode.create({ data: {
      organizationId, stallId: primaryStallId, diningTableId: table.id, token: tableQrToken,
      label: "P1 A1", tokenVersion: 1,
    } });
    const printer = await prisma.printer.create({ data: {
      organizationId, stallId: primaryStallId, name: "P1 QA 印表機", connectionType: "SYSTEM_PRINT",
    } });
    await prisma.printRule.create({ data: {
      organizationId, stallId: primaryStallId, printerId: printer.id,
      name: "P1 接單列印", trigger: "ORDER_CONFIRMED", documentType: "KITCHEN_TICKET",
    } });
    originalPrimaryBusinessHours = await prisma.stallBusinessHour.findMany({
      where: { stallId: primaryStallId },
      select: { id: true, opensAt: true, closesAt: true, isClosed: true },
    });
    await prisma.stallBusinessHour.updateMany({
      where: { stallId: primaryStallId },
      data: { opensAt: "00:00", closesAt: "00:00", isClosed: false },
    });
    await prisma.rateLimitBucket.deleteMany();
    await prisma.publicRateLimitBucket.deleteMany({
      where: { stallId: primaryStallId },
    });
    const staleTemplateStalls = await prisma.stall.findMany({
      where: { slug: { in: [sourceSlug, targetSlug] } },
      select: { id: true },
    });
    await prisma.billingStallUsageSummary.deleteMany({
      where: { stallId: { in: staleTemplateStalls.map((stall) => stall.id) } },
    });
    await prisma.stall.deleteMany({
      where: { slug: { in: [sourceSlug, targetSlug] } },
    });
    await prisma.discountOption.deleteMany({
      where: { stallId: primaryStallId, name: "7 折 P1" },
    });
    await prisma.orderSession.deleteMany({
      where: { order: { customerName: { startsWith: "P1 E2E" } } },
    });
    await prisma.order.deleteMany({
      where: {
        stallId: primaryStallId,
        customerName: { startsWith: "P1 E2E" },
      },
    });
    await prisma.cashShift.deleteMany({
      where: { stallId: primaryStallId, note: { startsWith: "P1 E2E" } },
    });
    const orderingSettings =
      await prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId: primaryStallId },
        select: { managerAuthorizationCodeHash: true },
      });
    originalManagerAuthorizationCodeHash =
      orderingSettings.managerAuthorizationCodeHash;
    await prisma.stallOrderingSettings.update({
      where: { stallId: primaryStallId },
      data: {
        managerAuthorizationCodeHash: await hash(managerAuthorizationCode, 10),
      },
    });

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId },
      select: { id: true },
    });
    additionalStallApprovalId = (
      await prisma.additionalStallApproval.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          quantity: 3,
          unitPrice: 0,
          reason: "P1 E2E fixture",
        },
      })
    ).id;

    const product = await prisma.product.findFirstOrThrow({
      where: { organizationId, name: "香酥雞排" },
    });
    const source = await prisma.stall.create({
      data: {
        organizationId,
        name: "P1 範本來源攤位",
        slug: sourceSlug,
        code: "P1-SOURCE",
        address: "台北市測試路 1 號",
        location: "台北市測試路 1 號",
        orderingSettings: {
          create: {
            organizationId,
            paymentModuleEnabled: true,
            discountModuleEnabled: true,
            discountApprovalThresholdBps: 8500,
          },
        },
        businessHours: {
          create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
            organizationId,
            dayOfWeek,
            opensAt: "10:00",
            closesAt: "20:00",
            isClosed: dayOfWeek === 1,
          })),
        },
        paymentOptions: {
          create: [
            {
              organizationId,
              code: "P1_PAY",
              name: "P1 行動支付",
              kind: "CUSTOM",
              isEnabled: true,
              sortOrder: 1,
            },
          ],
        },
        discountOptions: {
          create: [
            {
              organizationId,
              name: "P1 九折",
              rateBps: 9000,
              isEnabled: true,
              sortOrder: 1,
            },
          ],
        },
        stallProducts: {
          create: [
            {
              organizationId,
              productId: product.id,
              isEnabled: true,
              isSoldOut: true,
              sortOrder: 1,
            },
          ],
        },
      },
    });
    const target = await prisma.stall.create({
      data: {
        organizationId,
        name: "P1 範本目標攤位",
        slug: targetSlug,
        code: "P1-TARGET",
        address: "台北市測試路 2 號",
        location: "台北市測試路 2 號",
        orderingSettings: {
          create: {
            organizationId,
            paymentModuleEnabled: false,
            discountModuleEnabled: false,
            discountApprovalThresholdBps: 9500,
          },
        },
        businessHours: {
          create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
            organizationId,
            dayOfWeek,
            opensAt: "17:00",
            closesAt: "23:00",
            isClosed: false,
          })),
        },
      },
    });
    sourceStallId = source.id;
    targetStallId = target.id;
    highDiscountId = (
      await prisma.discountOption.create({
        data: {
          organizationId,
          stallId: primaryStallId,
          name: "7 折 P1",
          rateBps: 7000,
          isEnabled: true,
          sortOrder: 99,
        },
      })
    ).id;
  });

  test.afterAll(async () => {
    await prisma.rateLimitBucket.deleteMany();
    await prisma.publicRateLimitBucket.deleteMany({
      where: { stallId: primaryStallId },
    });
    if (createdOrderIds.length > 0) {
      await prisma.orderSession.deleteMany({
        where: { orderId: { in: createdOrderIds } },
      });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    await prisma.orderSession.deleteMany({
      where: { order: { customerName: { startsWith: "P1 E2E" } } },
    });
    await prisma.order.deleteMany({
      where: {
        stallId: primaryStallId,
        customerName: { startsWith: "P1 E2E" },
      },
    });
    await prisma.cashShift.deleteMany({
      where: { stallId: primaryStallId, note: { startsWith: "P1 E2E" } },
    });
    if (highDiscountId)
      await prisma.discountOption.deleteMany({ where: { id: highDiscountId } });
    await prisma.billingStallUsageSummary.deleteMany({
      where: {
        stallId: { in: [sourceStallId, targetStallId].filter(Boolean) },
      },
    });
    await prisma.stall.deleteMany({
      where: { id: { in: [sourceStallId, targetStallId].filter(Boolean) } },
    });
    if (additionalStallApprovalId) {
      await prisma.additionalStallApproval.deleteMany({
        where: { id: additionalStallApprovalId },
      });
    }
    await prisma.stallOrderingSettings.update({
      where: { stallId: primaryStallId },
      data: {
        managerAuthorizationCodeHash: originalManagerAuthorizationCodeHash,
      },
    });
    await prisma.$transaction(
      originalPrimaryBusinessHours.map((hour) =>
        prisma.stallBusinessHour.update({
          where: { id: hour.id },
          data: {
            opensAt: hour.opensAt,
            closesAt: hour.closesAt,
            isClosed: hour.isClosed,
          },
        }),
      ),
    );
    await prisma.billingStallUsageSummary.deleteMany({ where: { stallId: primaryStallId } });
    await prisma.stall.deleteMany({ where: { id: primaryStallId } });
    await prisma.$disconnect();
  });

  test("同桌追加點餐可合併結帳、經理核准、列印重試並納入現金交班", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    await login(page, "staff@stallorder.test");
    await page.goto(`/staff/${primaryStallSlug}/cash`);
    const openShiftTrigger = page.getByRole("button", {
      name: "開始現金班次",
      exact: true,
    });
    await expect(openShiftTrigger).toBeVisible();
    await openShiftTrigger.click();
    const openShiftDialog = page.getByRole("dialog", {
      name: "開啟現金班次",
      exact: true,
    });
    await expect(openShiftDialog).toBeVisible();
    await openShiftDialog.getByLabel("開班金額").fill("2000");
    await openShiftDialog.getByLabel("備註（選填）").fill("P1 E2E 班次");
    await openShiftDialog
      .getByRole("button", { name: "開始班次", exact: true })
      .click();
    await expect(page.getByText("班次進行中", { exact: true })).toBeVisible();
    await acknowledgeSuccessFeedback(page, "現金班次已開啟。");
    await page.getByRole("button", { name: /^記錄收支/ }).click();
    const movementDialog = page.getByRole("dialog", {
      name: "記錄現金收支",
      exact: true,
    });
    await expect(movementDialog).toBeVisible();
    await movementDialog.getByLabel("金額", { exact: true }).fill("500");
    await movementDialog
      .getByLabel("原因", { exact: true })
      .fill("P1 E2E 備用金");
    const movementResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/stalls/${primaryStallSlug}/cash-shifts`) &&
        response.request().method() === "POST",
    );
    await movementDialog
      .getByRole("button", { name: "新增紀錄", exact: true })
      .click();
    expect((await movementResponse).status()).toBe(200);
    await expect(page.getByText(/P1 E2E 備用金/)).toBeVisible();

    const firstContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const secondContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const firstCustomer = await firstContext.newPage();
    const secondCustomer = await secondContext.newPage();
    const firstOrderNo = await createDineInOrder(
      firstCustomer,
      "香酥雞排",
    );
    const secondOrderNo = await createDineInOrder(
      secondCustomer,
      "地瓜薯條",
    );

    await page.goto(`/staff/${primaryStallSlug}`);
    await dismissStaffStartReminder(page);
    const orderSearch = page
      .getByRole("main")
      .getByPlaceholder("搜尋桌號、訂單編號或顧客");
    for (const orderNo of [firstOrderNo, secondOrderNo]) {
      await orderSearch.fill(orderNo);
      await page
        .getByTestId("staff-order-list-pane")
        .getByRole("button")
        .filter({ hasText: orderNo })
        .click();
      const orderItems = page.getByTestId("staff-order-items-pane");
      const orderActions = page.getByTestId("staff-order-actions-pane");
      await orderActions
        .getByRole("button", { name: "確認接單", exact: true })
        .click();
      await orderItems.getByRole("button", { name: "全部開始製作（1）" }).click();
      await orderItems.getByRole("button", { name: "全部餐點完成（1）" }).click();
      await orderItems.getByRole("button", { name: "全部標記已出餐（1）" }).click();
      await expect(orderItems.getByText("已出餐", { exact: true })).toBeVisible();
    }

    await orderSearch.fill("");
    await page.getByRole("button", { name: "同桌合併" }).click();
    const tableGroup = page
      .getByRole("article")
      .filter({ hasText: firstOrderNo });
    await expect(tableGroup).toContainText(secondOrderNo);
    await tableGroup.getByRole("button", { name: "合併結帳（2 筆）" }).click();
    const checkout = page.getByRole("dialog", { name: "同桌合併結帳" });
    await checkout.getByTestId("staff-discount-trigger").click();
    const discountDialog = page.getByRole("dialog", { name: "結帳折扣" });
    await expect(discountDialog).toBeVisible();
    await discountDialog.getByRole("button", { name: "7 折 P1" }).click();
    await expect(checkout.getByText("此折扣超過店員免核准門檻")).toBeVisible();
    await checkout.getByLabel("折扣原因").fill("P1 E2E 等候補償");
    await checkout.getByLabel("管理授權碼").fill(managerAuthorizationCode);
    await checkout.getByRole("button", { name: "$500" }).click();
    await expect(checkout).toContainText("$106");
    await checkout
      .getByRole("button", { name: "完成訂單", exact: true })
      .click();
    await expect(checkout).toHaveCount(0);

    const checkedOutOrders = await prisma.order.findMany({
      where: {
        orderNo: { in: [firstOrderNo, secondOrderNo] },
        stallId: primaryStallId,
      },
      include: { payment: true, discountApprovedBy: true },
    });
    expect(checkedOutOrders).toHaveLength(2);
    expect(
      checkedOutOrders.every(
        (order) =>
          order.status === "COMPLETED" &&
          order.discountApprovalReason === "P1 E2E 等候補償",
      ),
    ).toBe(true);
    expect(
      checkedOutOrders.every(
        (order) => order.discountApprovedBy?.email === "staff@stallorder.test",
      ),
    ).toBe(true);
    expect(
      new Set(checkedOutOrders.map((order) => order.payment?.checkoutGroupId))
        .size,
    ).toBe(1);

    await page.goto(`/staff/${primaryStallSlug}/print`);
    const takeOverPrinter = page
      .getByRole("button", { name: "本機接手" })
      .first();
    await waitForReactHydration(takeOverPrinter);
    const heartbeatResponse = waitForPrintOperation(page, "HEARTBEAT");
    await takeOverPrinter.click();
    expect((await heartbeatResponse).status()).toBe(200);
    await expect(page.getByText(/本機接手中/)).toBeVisible();
    await acknowledgeSuccessFeedback(
      page,
      "此裝置已開始回報印表機連線狀態。",
    );
    const initialJob = page
      .getByRole("article")
      .filter({ hasText: firstOrderNo })
      .first();
    await expect(initialJob).toContainText("待列印");
    await runPrintAction(
      page,
      initialJob.getByRole("button", { name: "開始列印" }),
      "CLAIM",
    );
    await runPrintAction(
      page,
      initialJob.getByRole("button", { name: "成功" }),
      "SUCCESS",
    );
    await expect(initialJob).toContainText("列印成功");
    await runPrintAction(
      page,
      initialJob.getByRole("button", { name: "補印" }),
      "REPRINT",
    );
    const reprintJob = page
      .getByRole("article")
      .filter({ hasText: firstOrderNo })
      .filter({ hasText: "補印" })
      .first();
    await expect(reprintJob).toContainText("補印");
    await runPrintAction(
      page,
      reprintJob.getByRole("button", { name: "開始列印" }),
      "CLAIM",
    );
    await runPrintAction(
      page,
      reprintJob.getByRole("button", { name: "失敗" }),
      "FAIL",
    );
    await expect(reprintJob).toContainText("列印失敗");
    await runPrintAction(
      page,
      reprintJob.getByRole("button", { name: "重試" }),
      "RETRY",
    );
    await expect(reprintJob).toContainText("待列印");

    await page.goto(`/staff/${primaryStallSlug}/cash`);
    const cashMain = page.locator("#main-content");
    await expect(cashMain).toHaveCount(1);
    await expect(cashMain.getByText("$2,606", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^盤點交班/ }).click();
    const closeShiftDialog = page.getByRole("dialog", {
      name: "盤點並交班",
      exact: true,
    });
    await expect(closeShiftDialog).toBeVisible();
    await closeShiftDialog.getByLabel("實際盤點金額").fill("2606");
    await expect(page.getByText("帳款相符", { exact: true })).toBeVisible();
    const closeShiftResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/stalls/${primaryStallSlug}/cash-shifts`) &&
        response.request().method() === "POST",
    );
    await closeShiftDialog
      .getByRole("button", { name: "送出交班複核", exact: true })
      .click();
    expect((await closeShiftResponse).status()).toBe(200);
    const pendingShiftCard = page
      .getByRole("article")
      .filter({ hasText: "P1 E2E 班次" });
    await expect(
      pendingShiftCard.getByText("等待複核", { exact: true }),
    ).toBeVisible();
    const pendingShift = await prisma.cashShift.findFirstOrThrow({
      where: { stallId: primaryStallId, note: "P1 E2E 班次" },
      orderBy: { openedAt: "desc" },
    });
    expect(pendingShift.status).toBe("CLOSING");
    expect(pendingShift.varianceAmount).toBe(0);

    const cancelContext = await browser.newContext({
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const cancelCustomer = await cancelContext.newPage();
    const cancelledOrderNo = await createDineInOrder(
      cancelCustomer,
      "香酥雞排",
    );
    await page.goto(`/staff/${primaryStallSlug}`);
    await dismissStaffStartReminder(page);
    const cancellationMain = page.getByRole("main");
    await cancellationMain
      .getByPlaceholder("搜尋桌號、訂單編號或顧客")
      .fill(cancelledOrderNo);
    const cancelledOrder = cancellationMain
      .getByTestId("staff-order-list-pane")
      .getByRole("button")
      .filter({ hasText: cancelledOrderNo });
    await cancelledOrder.click();
    await cancellationMain
      .getByTestId("staff-order-actions-pane")
      .getByRole("button", { name: "取消訂單" })
      .click();
    const cancellation = page.getByRole("alertdialog", {
      name: "確認取消訂單？",
    });
    await cancellation.getByLabel("取消原因").selectOption("SOLD_OUT");
    await cancellation.getByLabel(/補充說明/).fill("P1 E2E 商品售罄");
    await cancellation.getByLabel("管理授權碼").fill(managerAuthorizationCode);
    const cancellationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes(
          `/api/stalls/${primaryStallSlug}/orders/`,
        ) && response.request().method() === "PATCH",
      { timeout: 30_000 },
    );
    await cancellation.getByRole("button", { name: "確認取消訂單" }).click();
    expect((await cancellationResponse).status()).toBe(200);
    await expect(cancelledOrder).toHaveCount(0);
    const cancelledRecord = await prisma.order.findFirstOrThrow({
      where: { stallId: primaryStallId, orderNo: cancelledOrderNo },
    });
    expect(cancelledRecord.cancellationReason).toBe("SOLD_OUT");
    expect(cancelledRecord.cancellationDetail).toBe("P1 E2E 商品售罄");

    await firstContext.close();
    await secondContext.close();
    await cancelContext.close();
  });

  test("多攤位範本先顯示差異再套用全部營運設定", async ({ page }) => {
    await login(page, "owner@stallorder.test");
    await page.goto(`/merchant/stalls/${targetStallId}/settings/templates`);
    await expect(
      page.getByRole("heading", { name: "多攤位範本", exact: true }),
    ).toBeVisible();
    const template = page.getByRole("region", {
      name: "多攤位範本",
      exact: true,
    });
    await template.getByLabel("來源攤位").selectOption(sourceStallId);
    await template.getByRole("button", { name: "比較差異" }).click();
    await expect(template).toContainText("付款方式");
    await expect(template).toContainText("經理核准門檻：8.5 折以下");
    await expect(template).toContainText("商品供應");
    await expect(template).toContainText("營業時間");
    page.once("dialog", (dialog) => dialog.accept());
    await template.getByRole("button", { name: "套用所選設定" }).click();
    await expect(template.getByRole("status")).toContainText("攤位範本已套用");

    const [payment, discounts, products, hours, settings] = await Promise.all([
      prisma.paymentOption.findMany({
        where: { stallId: targetStallId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.discountOption.findMany({
        where: { stallId: targetStallId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.stallProduct.findMany({ where: { stallId: targetStallId } }),
      prisma.stallBusinessHour.findMany({
        where: { stallId: targetStallId },
        orderBy: { dayOfWeek: "asc" },
      }),
      prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId: targetStallId },
      }),
    ]);
    expect(payment.map((option) => option.code)).toEqual(["P1_PAY"]);
    expect(discounts.map((option) => option.name)).toEqual(["P1 九折"]);
    expect(products).toHaveLength(1);
    expect(products[0]?.isSoldOut).toBe(true);
    expect(hours).toHaveLength(7);
    expect(
      hours.every(
        (hour) => hour.opensAt === "10:00" && hour.closesAt === "20:00",
      ),
    ).toBe(true);
    expect(settings.paymentModuleEnabled).toBe(true);
    expect(settings.discountModuleEnabled).toBe(true);
    expect(settings.discountApprovalThresholdBps).toBe(8500);
  });
});

async function login(page: Page, email: string) {
  const warmupResponse = await page.context().request.get("/api/auth/login");
  expect(warmupResponse.status()).toBe(405);
  await warmupResponse.dispose();
  const destination = email === "staff@stallorder.test" ? `/staff/${primaryStallSlug}` : `/merchant/dashboard?organizationId=${organizationId}`;
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  const emailLogin = page.getByRole("button", {
    name: "使用電子郵件與密碼登入",
    exact: true,
  });
  await waitForReactHydration(emailLogin);
  await emailLogin.click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const submit = page.getByRole("button", { name: "登入", exact: true });
  await waitForReactHydration(submit);
  const loginResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/login" &&
      response.request().method() === "POST",
    { timeout: 30_000 },
  );
  await submit.click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(
    /\/merchant\/dashboard\?organizationId=|\/staff\//,
    { timeout: 30_000 },
  );
}

async function createDineInOrder(page: Page, productName: string) {
  const qrPath = `/q/${tableQrToken}`;
  const qrResponse = await page.goto(qrPath, {
    waitUntil: "domcontentloaded",
  });
  expect(qrResponse?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(qrPath);
  const product = page.getByRole("article").filter({ hasText: productName });
  await qrProductSelectionControl(
    product,
    productName,
    `增加 ${productName}`,
  ).click();
  await product
    .getByRole("button", { name: "加入購物車", exact: true })
    .click();
  const continueButton = page.getByRole("button", { name: "繼續填寫訂購資料", exact: true });
  if (await continueButton.isVisible()) await continueButton.click();
  await continueQrCheckout(page);
  const waitAcknowledgment = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間/,
  });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();
  await expect(page.getByLabel("顧客稱呼")).toHaveCount(0);
  await expect(page.getByLabel("聯絡電話", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("訂單備註", { exact: true })).toBeVisible();
  const submitButton = page.getByRole("button", {
    name: "送出訂單",
    exact: true,
  });
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  let responsePromise = page.waitForResponse(
    (response) =>
      ["/create-public-order", "/api/public/orders"].some(path => new URL(response.url()).pathname.endsWith(path)) &&
      response.request().method() === "POST",
  );
  await submitButton.click();
  let response = await responsePromise;
  if (response.status() === 422) {
    await expect(response.json()).resolves.toMatchObject({
      code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
    });
    await expect(waitAcknowledgment).toBeVisible();
    await waitAcknowledgment.check();
    await expect(submitButton).toBeEnabled({ timeout: 15_000 });
    responsePromise = page.waitForResponse(
      (nextResponse) =>
        ["/create-public-order", "/api/public/orders"].some(path => new URL(nextResponse.url()).pathname.endsWith(path)) &&
        nextResponse.request().method() === "POST",
    );
    await submitButton.click();
    response = await responsePromise;
  }
  expect(response.status()).toBe(201);
  const request = response.request().postDataJSON() as {
    clientOrderId?: string;
    customerName?: string;
    customerPhone?: string;
  };
  expect(request).toMatchObject({ customerName: "", customerPhone: "" });
  expect(request.clientOrderId).toEqual(expect.any(String));
  createdOrderIds.push(request.clientOrderId as string);
  await expect(page).toHaveURL(/\/order\//);
  const orderText = await page
    .getByText(/^訂單 /)
    .first()
    .textContent();
  if (!orderText) throw new Error("找不到新訂單編號");
  return orderText.replace(/^訂單\s+/, "").trim();
}

async function waitForReactHydration(control: Locator) {
  await expect
    .poll(
      () =>
        control.evaluate((element) =>
          Object.keys(element).some(
            (key) =>
              key.startsWith("__reactProps$") ||
              key.startsWith("__reactFiber$"),
          ),
        ),
      { message: "等待 React 完成控制項 hydration" },
    )
    .toBe(true);
}

function waitForPrintOperation(page: Page, operation: string) {
  return page.waitForResponse((response) => {
    if (
      !new URL(response.url()).pathname.endsWith("/print-jobs") ||
      response.request().method() !== "POST"
    )
      return false;
    try {
      const body = response.request().postDataJSON() as { operation?: string };
      return body.operation === operation;
    } catch {
      return false;
    }
  });
}

async function runPrintAction(page: Page, control: Locator, operation: string) {
  await expect(control).toBeEnabled();
  await waitForReactHydration(control);
  await expect(control).toBeEnabled();
  const response = waitForPrintOperation(page, operation);
  await control.click();
  expect((await response).status()).toBe(200);
  const feedbackByOperation: Record<string, string> = {
    SUCCESS: "已記錄列印成功。",
    FAIL: "已記錄列印失敗，可重新排入。",
    RETRY: "已重新排入列印佇列。",
    REPRINT: "補印工作已建立。",
  };
  const feedback = feedbackByOperation[operation];
  if (feedback) await acknowledgeSuccessFeedback(page, feedback);
}

async function acknowledgeSuccessFeedback(page: Page, message: string) {
  const dialog = page.getByRole("dialog", {
    name: "操作已完成",
    exact: true,
  });
  await expect(dialog).toContainText(message);
  await dialog
    .getByRole("button", { name: "我知道了", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 必須設定 DATABASE_URL");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost")
    throw new Error(`拒絕在非本機資料庫執行 E2E：${hostname}`);
}

function loadLocalEnv() {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    const value = match[2].trim();
    process.env[match[1]] =
      value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
}
