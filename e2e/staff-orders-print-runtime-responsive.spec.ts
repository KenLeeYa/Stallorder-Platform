import { searchStaffOrders } from "./helpers/staff-search";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  addFirstStaffCatalogProduct,
  dismissStaffStartReminder,
  gotoLocalPath,
  loginLocalTestAccount,
} from "./local-navigation";

import { assertResponsiveQaMode } from "../scripts/responsive-qa-target.mjs";

const password = "StallOrderDemo!2026";
const stallSlug = "aming-chicken";

test.use({ serviceWorkers: "block" });

let responsivePrisma: PrismaClient;
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let responsiveOrderId = "";
let responsiveOrderNo = "";

test.beforeAll(async () => {
  loadLocalEnv();
  assertLocalDatabase();
  responsivePrisma = new PrismaClient();
  const unique = randomUUID();
  const product = await responsivePrisma.product.findFirstOrThrow({
    where: {
      organizationId,
      stallProducts: { some: { stallId, isEnabled: true } },
    },
    select: { id: true, name: true },
  });
  const order = await responsivePrisma.order.create({
    data: {
      organizationId,
      stallId,
      orderNo: `RESP-${Date.now().toString().slice(-7)}-${unique.slice(0, 4)}`,
      trackingTokenHash: createHash("sha256")
        .update(`tracking-${unique}`)
        .digest("hex"),
      idempotencyKey: randomUUID(),
      source: "STAFF_POS",
      origin: "ONLINE_STAFF",
      isTest: true,
      customerName: "響應式版面測試",
      fulfillmentType: "TAKEOUT",
      status: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      subtotal: 95 * 25,
      total: 95 * 25,
      deviceHash: createHash("sha256").update(`device-${unique}`).digest("hex"),
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000),
      items: {
        create: Array.from({ length: 25 }, (_, index) => ({
          organizationId,
          stallId,
          productId: product.id,
          name: product.name,
          baseUnitPrice: 95,
          unitPrice: 95,
          quantity: 1,
          status: "PENDING" as const,
          note: `響應式測試品項 ${index + 1}`,
        })),
      },
    },
    select: { id: true, orderNo: true },
  });
  responsiveOrderId = order.id;
  responsiveOrderNo = order.orderNo;
});

test.afterAll(async () => {
  if (responsiveOrderId) {
    await responsivePrisma.order.deleteMany({ where: { id: responsiveOrderId } });
  }
  await responsivePrisma?.$disconnect();
});

test("店員訂單在手機採單欄，平板與桌機採清單、品項、操作三欄版面", async ({ page }) => {
  test.setTimeout(120_000);
  await loginLocalTestAccount(page, "staff@stallorder.test", password);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, `/staff/${stallSlug}`);
  await dismissStaffStartReminder(page);

  const workspace = page.locator("#main-content").getByTestId("staff-primary-workspace");
  await expect(workspace).toHaveCount(1);
  const mobileList = workspace.getByTestId("staff-order-mobile-list");
  const masterDetail = workspace.getByTestId("staff-order-master-detail");
  await expect(mobileList).toBeVisible();
  await expect(mobileList.locator("article").first()).toBeVisible();
  await expect(masterDetail).toBeHidden();
  // Search remains global; locate the fixture independently of its queue page.
  await searchStaffOrders(page, responsiveOrderNo);

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(mobileList).toBeHidden();
    await expect(masterDetail).toBeVisible();

    const listPane = masterDetail.getByTestId("staff-order-list-pane");
    const itemsPane = masterDetail.getByTestId("staff-order-items-pane");
    const actionsPane = masterDetail.getByTestId("staff-order-actions-pane");
    await expect(listPane).toBeVisible();
    await expect(itemsPane).toBeVisible();
    await expect(actionsPane).toBeVisible();
    if (viewport.width === 768) {
      await expect(listPane.getByRole("button").first()).toHaveAttribute("aria-current", "true");
    }
    const fixtureOrder = listPane.getByRole("button").filter({ hasText: responsiveOrderNo });
    await fixtureOrder.click();
    await expect(fixtureOrder).toHaveAttribute("aria-current", "true");
    await expect(itemsPane.getByTestId("staff-order-item-list").locator("li")).toHaveCount(25);
    await expect(itemsPane.getByRole("heading", { name: "訂單品項", exact: true })).toBeVisible();
    await expect(actionsPane.getByRole("heading", { name: "訂單操作", exact: true })).toBeVisible();

    const selectedOrderNumber = await listPane.locator('button[aria-current="true"] strong').textContent();
    expect(selectedOrderNumber).toBeTruthy();
    await expect(masterDetail.getByText(selectedOrderNumber!, { exact: true })).toHaveCount(1);

    const [layoutBox, listBox, itemsBox, actionsBox, overflow] = await Promise.all([
      masterDetail.boundingBox(),
      listPane.boundingBox(),
      itemsPane.boundingBox(),
      actionsPane.boundingBox(),
      page.evaluate(() => ({
        list: getComputedStyle(document.querySelector<HTMLElement>('#main-content [data-testid="staff-order-list-pane"]')!).overflowY,
        items: getComputedStyle(document.querySelector<HTMLElement>('#main-content [data-testid="staff-order-items-pane"]')!).overflowY,
        actions: getComputedStyle(document.querySelector<HTMLElement>('#main-content [data-testid="staff-order-actions-pane"]')!).overflowY,
        pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      })),
    ]);
    expect(layoutBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(itemsBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(listBox!.x + listBox!.width).toBeLessThan(itemsBox!.x);
    expect(itemsBox!.x + itemsBox!.width).toBeLessThan(actionsBox!.x);
    expect(layoutBox!.x + layoutBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(layoutBox!.y + layoutBox!.height).toBeLessThanOrEqual(viewport.height);
    expect(layoutBox!.y + layoutBox!.height).toBeGreaterThan(viewport.height - 24);
    expect(overflow).toEqual({ list: "auto", items: "auto", actions: "auto", pageFits: true });
    await page.screenshot({ path: test.info().outputPath(`full-board-${viewport.width}.png`) });

    const longOrderScroll = await page.evaluate(() => {
      const itemsPaneElement = document.querySelector<HTMLElement>('#main-content [data-testid="staff-order-items-pane"]')!;
      const actionsPaneElement = document.querySelector<HTMLElement>('#main-content [data-testid="staff-order-actions-pane"]')!;
      itemsPaneElement.scrollTop = itemsPaneElement.scrollHeight;
      const result = {
        canScroll: itemsPaneElement.scrollHeight > itemsPaneElement.clientHeight,
        didScroll: itemsPaneElement.scrollTop > 0,
        actionsStayedPut: actionsPaneElement.scrollTop === 0,
      };
      itemsPaneElement.scrollTop = 0;
      return result;
    });
    expect(longOrderScroll).toEqual({ canScroll: true, didScroll: true, actionsStayedPut: true });
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("所有已授權的 Staff 工具列動作在手機、平板與桌機皆可觸及", async ({ page }) => {
  test.setTimeout(120_000);
  const settings = await responsivePrisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { printModuleEnabled: true } });
  await responsivePrisma.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: true } });
  try {
    await loginLocalTestAccount(page, "staff@stallorder.test", password);
    await gotoLocalPath(page, `/staff/${stallSlug}`);
    await dismissStaffStartReminder(page);
    const toolbar = page.getByTestId("staff-function-grid");
    const role = toolbar.locator('button:has([data-testid="work-mode-icon-staff"])');
    const sound = toolbar.getByRole("switch", { name: /新單提示音/ });
    const wake = toolbar.getByTestId("pwa-wake-control").first();
    const print = toolbar.getByRole("link", { name: "列印佇列" });
    const live = toolbar.getByTestId("staff-common-controls").getByRole("status");
    const pickup = toolbar.getByTestId("staff-pickup-code-lookup");
    const qr = toolbar.getByTestId("staff-platform-qr-pickup");
    await expect(role).toHaveCount(0); // The isolated Staff account has no authorized mode switch.
    await expect(qr).toHaveCount(0); // LINE Platform pickup capability is disabled in this lab.
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 768) {
        const toggle = page.getByTestId("staff-tools-toggle");
        if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
        await expect(toolbar.getByRole("button", { name: "切換為暗黑模式" })).toBeHidden();
        await expect(toolbar.getByTestId("staff-push-controls")).toBeHidden();
        await expect(sound).toBeVisible();
        await expect(print).toBeVisible();
        await toggle.click();
      }
      const expected = [
        sound, print,
        toolbar.getByRole("link", { name: "員工定位打卡" }),
        toolbar.getByRole("button", { name: "店員點餐", exact: true }), pickup,
        toolbar.getByRole("link", { name: "桌位平面圖" }),
        toolbar.getByRole("link", { name: "現金交班" }),
        toolbar.getByTestId("staff-capacity-compact").locator("summary"),
        toolbar.getByTestId("staff-search-open"),
        toolbar.getByRole("combobox", { name: "語言" }),
        toolbar.getByRole("button", { name: "切換為暗黑模式" }),
        toolbar.getByRole("button", { name: "切換為年長者模式" }),
        toolbar.getByTestId("staff-push-controls").getByRole("button", { name: "鎖屏通知" }),
        toolbar.getByTestId("staff-function-offline").locator("button").first(),
        toolbar.getByRole("button", { name: "重新整理" }),
        toolbar.getByTestId("staff-function-logout").locator("button"),
        toolbar.getByRole("button", { name: "逐筆訂單" }),
        toolbar.getByRole("button", { name: "同桌合併" }),
      ];
      if (await wake.count()) expected.push(wake);
      for (const control of expected) {
        await expect(control).toBeVisible();
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        const label = await control.getAttribute("aria-label") ?? await control.getAttribute("title") ?? await control.textContent();
        expect(box!.width, `${width}px ${label}`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${width}px ${label}`).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      if (width < 768) {
        const sse = (await live.boundingBox())!;
        for (const control of [sound, print, ...(await wake.count() ? [wake] : [])]) {
          const box = (await control.boundingBox())!;
          expect(box.x + box.width).toBeLessThanOrEqual(sse.x + 1);
        }
      }
      const capacityBox = (await toolbar.getByTestId("staff-capacity-compact").boundingBox())!;
      const searchBox = (await toolbar.getByTestId("staff-search-open").boundingBox())!;
      expect(searchBox.x).toBeGreaterThanOrEqual(capacityBox.x + capacityBox.width);
    }
  } finally {
    await responsivePrisma.stallOrderingSettings.update({ where: { stallId }, data: { printModuleEnabled: settings.printModuleEnabled } });
  }
});

for (const redesignEnabled of [false, true]) {
  test(`手機訂單明細可返回原卡片，旋轉後仍可操作（新工作台 ${redesignEnabled ? "開" : "關"}）`, async ({ page }) => {
    test.setTimeout(120_000);
    const existingFlag = await responsivePrisma.resilienceFeatureFlag.findUnique({
      where: { code: "STAFF_WORKSPACE_REDESIGN_ENABLED" }, select: { id: true },
    });
    const flag = existingFlag ?? await responsivePrisma.resilienceFeatureFlag.create({ data: {
      code: "STAFF_WORKSPACE_REDESIGN_ENABLED", defaultEnabled: false,
      description: "Isolated responsive Staff layout QA",
    }, select: { id: true } });
    const existing = await responsivePrisma.resilienceFeatureFlagOverride.findFirst({
      where: { flagId: flag.id, scopeType: "STALL", stallId },
      select: { id: true, enabled: true },
    });
    const override = existing
      ? await responsivePrisma.resilienceFeatureFlagOverride.update({ where: { id: existing.id }, data: { enabled: redesignEnabled } })
      : await responsivePrisma.resilienceFeatureFlagOverride.create({ data: {
        flagId: flag.id, scopeType: "STALL", organizationId, stallId,
        enabled: redesignEnabled, reason: "Isolated responsive Staff layout QA",
        expiresAt: new Date(Date.now() + 10 * 60_000),
      } });
    try {
      await loginLocalTestAccount(page, "staff@stallorder.test", password);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(2100); // The server's flag snapshot has a two-second TTL.
      await gotoLocalPath(page, `/staff/${stallSlug}`);
      await dismissStaffStartReminder(page);
      await searchStaffOrders(page, responsiveOrderNo);
      const mobileList = page.getByTestId("staff-order-mobile-list");
      const card = mobileList.locator("article").filter({ hasText: responsiveOrderNo });
      await expect(card).toContainText("測試訂單");
      await expect(card.locator(":scope > p").first()).toHaveCSS("font-size", "16px");
      await expect(card.locator(":scope > p").last()).toHaveCSS("font-size", "16px");
      const open = card.getByRole("button", { name: "查看明細" });
      await open.scrollIntoViewIfNeeded();
      const before = await card.boundingBox();
      await open.click();
      const detail = page.getByRole("dialog", { name: `訂單 ${responsiveOrderNo}` });
      await expect(detail).toBeVisible();
      await expect(detail.getByTestId("staff-mobile-detail-summary")).toContainText("店員點餐");
      await expect(detail.getByTestId("staff-mobile-detail-summary")).toContainText("測試訂單");
      await expect(detail.getByTestId("staff-mobile-detail-summary")).toContainText("$2,375");
      await expect(detail.getByTestId("staff-order-item-list").locator("li")).toHaveCount(25);
      await expect(detail.getByTestId("staff-order-actions-pane")).toBeVisible();
      await detail.getByRole("button", { name: "關閉" }).click();
      await expect(open).toBeFocused();
      expect(Math.abs((await card.boundingBox())!.y - before!.y)).toBeLessThan(2);

      for (const width of [768, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        const board = page.getByTestId("staff-order-master-detail");
        await expect(board.getByTestId("staff-order-list-pane")).toBeVisible();
        await expect(board.getByTestId("staff-order-items-pane")).toBeVisible();
        await expect(board.getByTestId("staff-order-actions-pane")).toBeVisible();
        await expect(board.getByRole("button").filter({ hasText: responsiveOrderNo }).first()).toHaveAttribute("aria-current", "true");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(card).toBeVisible();
      await expect(page.getByTestId("staff-search-open")).toHaveAttribute("class", /border-teal-700/);
      await page.setViewportSize({ width: 768, height: 900 });
      const waiting = page.getByTestId("staff-queue-filters").locator("button").filter({ hasText: "待接單" });
      const source = page.getByTestId("staff-queue-source").locator("select");
      if (redesignEnabled) {
        await waiting.click();
        await source.selectOption("STAFF_POS");
      }
      const selected = page.getByTestId("staff-order-list-pane").locator("button").filter({ hasText: responsiveOrderNo });
      await selected.click();
      await page.getByRole("button", { name: "店員點餐", exact: true }).click();
      const pos = page.getByRole("dialog", { name: "店員點餐", exact: true });
      await addFirstStaffCatalogProduct(page, pos);
      for (const width of [1024, 390, 768]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390) await pos.getByTestId("staff-order-cart-tab").click();
        await expect(pos.getByTestId("staff-cart-live-total")).toContainText("1 份");
        await expect(pos.getByTestId("staff-cart-live-total").locator("strong")).toContainText("$");
        await expect(page.getByTestId("staff-search-open")).toHaveAttribute("class", /border-teal-700/);
        await expect(selected).toHaveAttribute("aria-current", "true");
        if (redesignEnabled) {
          await expect(waiting).toHaveAttribute("aria-pressed", "true");
          await expect(source).toHaveValue("STAFF_POS");
        }
      }
      page.once("dialog", (dialog) => dialog.accept());
      await pos.getByRole("button", { name: "關閉店員點餐", exact: true }).click();
      await expect(pos).toBeHidden();
      await expect(selected).toBeVisible();
      for (const isTest of [false, true]) {
        await responsivePrisma.order.update({ where: { id: responsiveOrderId }, data: { isTest } });
        await page.reload(); await dismissStaffStartReminder(page); await searchStaffOrders(page, responsiveOrderNo);
        for (const width of [320, 390, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          if (width < 768) {
            const mobileCard = page.getByTestId("staff-order-mobile-list").getByRole("article").filter({ hasText: responsiveOrderNo });
            await expect(mobileCard.getByText("測試訂單", { exact: true })).toHaveCount(isTest ? 1 : 0);
            await mobileCard.getByRole("button", { name: "查看明細", exact: true }).click();
            const summary = page.getByTestId("staff-mobile-detail-summary");
            await expect(summary.getByText("測試訂單", { exact: true })).toHaveCount(isTest ? 1 : 0);
            await expect(page.getByTestId("staff-order-mobile-detail").getByTestId("staff-order-actions-pane")).toBeVisible();
            await page.getByRole("dialog", { name: `訂單 ${responsiveOrderNo}` }).getByRole("button", { name: "關閉", exact: true }).click();
          } else {
            const desktopCard = page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: responsiveOrderNo });
            await expect(desktopCard.getByText("測試訂單", { exact: true })).toHaveCount(isTest ? 1 : 0);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
      }
    } finally {
      await responsivePrisma.order.update({ where: { id: responsiveOrderId }, data: { isTest: true } });
      if (existing) await responsivePrisma.resilienceFeatureFlagOverride.update({ where: { id: override.id }, data: { enabled: existing.enabled } });
      else await responsivePrisma.resilienceFeatureFlagOverride.delete({ where: { id: override.id } });
      if (!existingFlag) await responsivePrisma.resilienceFeatureFlag.delete({ where: { id: flag.id } });
    }
  });
}

test("KDS 開啟時手機訂單明細三個整批動作皆有 44px 命中區", async ({ page }) => {
  test.setTimeout(120_000);
  const settings = await responsivePrisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId }, select: { kdsModuleEnabled: true } });
  const items = await responsivePrisma.orderItem.findMany({ where: { orderId: responsiveOrderId }, select: { id: true, status: true }, orderBy: { createdAt: "asc" } });
  await responsivePrisma.stallOrderingSettings.update({ where: { stallId }, data: { kdsModuleEnabled: true } });
  await responsivePrisma.order.update({ where: { id: responsiveOrderId }, data: { status: "CONFIRMED" } });
  await responsivePrisma.orderItem.update({ where: { id: items[1].id }, data: { status: "PREPARING" } });
  await responsivePrisma.orderItem.update({ where: { id: items[2].id }, data: { status: "READY" } });
  try {
    await loginLocalTestAccount(page, "staff@stallorder.test", password);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLocalPath(page, `/staff/${stallSlug}`);
    await dismissStaffStartReminder(page);
    await searchStaffOrders(page, responsiveOrderNo);
    const card = page.getByTestId("staff-order-mobile-list").locator("article").filter({ hasText: responsiveOrderNo });
    await card.getByRole("button", { name: "查看明細" }).click();
    const detail = page.getByRole("dialog", { name: `訂單 ${responsiveOrderNo}` });
    const bulk = detail.getByTestId("staff-order-items-pane").getByRole("button", { name: /^全部/ });
    await expect(bulk).toHaveCount(3);
    for (const width of [390, 600]) {
      await page.setViewportSize({ width, height: 844 });
      for (const button of await bulk.all()) {
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
    for (const button of await bulk.all()) await expect(button).toHaveCSS("min-height", "44px");
  } finally {
    await responsivePrisma.orderItem.update({ where: { id: items[1].id }, data: { status: items[1].status } });
    await responsivePrisma.orderItem.update({ where: { id: items[2].id }, data: { status: items[2].status } });
    await responsivePrisma.order.update({ where: { id: responsiveOrderId }, data: { status: "WAITING_CONFIRMATION" } });
    await responsivePrisma.stallOrderingSettings.update({ where: { stallId }, data: { kdsModuleEnabled: settings.kdsModuleEnabled } });
  }
});

test("手機明細的訂單消失後回到仍可操作的列表", async ({ page }) => {
  test.setTimeout(120_000);
  await loginLocalTestAccount(page, "staff@stallorder.test", password);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, `/staff/${stallSlug}`);
  await dismissStaffStartReminder(page);
  await searchStaffOrders(page, responsiveOrderNo);
  const card = page.getByTestId("staff-order-mobile-list").locator("article").filter({ hasText: responsiveOrderNo });
  await card.getByRole("button", { name: "查看明細" }).click();
  const detail = page.getByRole("dialog", { name: `訂單 ${responsiveOrderNo}` });
  await expect(detail).toBeVisible();
  try {
    await responsivePrisma.order.update({ where: { id: responsiveOrderId }, data: { status: "COMPLETED" } });
    await page.getByTestId("staff-function-grid").locator('button[title="重新整理"]').evaluate((button: HTMLButtonElement) => button.click());
    await expect(detail).toBeHidden();
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement && active.isConnected && Boolean(
        active.closest('[data-testid="staff-order-mobile-list"]')
        || active.matches('[data-testid="staff-queue-toggle"], [data-testid="staff-search-open"]'),
      );
    })).toBe(true);
  } finally {
    await responsivePrisma.order.update({ where: { id: responsiveOrderId }, data: { status: "WAITING_CONFIRMATION" } });
  }
});

test("Star webPRNT SDK 載入失敗會在有限時間內離開永久載入狀態", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) StarWebPRNTBrowser/3.0",
    viewport: { width: 768, height: 1024 },
  });
  try {
    const page = await context.newPage();
    await page.route("**/vendor/star-webprnt/StarWebPrintTrader-1.2.0.js", (route) => route.abort());
    await loginLocalTestAccount(page, "staff@stallorder.test", password);
    await gotoLocalPath(page, `/staff/${stallSlug}/print`);

    const loading = page.getByText("正在載入 Star 藍牙列印模組…", { exact: true });
    const failure = page.getByText("Star 藍牙列印模組載入失敗，請重新整理。", { exact: true });
    await expect(loading.or(failure)).toBeVisible();
    await expect(failure).toBeVisible({ timeout: 12_000 });
    await expect(loading).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("修改既有自動出單規則只送出嚴格 command 欄位", async ({ page }) => {
  test.setTimeout(60_000);
  loadLocalEnv();
  assertLocalDatabase();
  const prisma = new PrismaClient();
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const stallId = "22222222-2222-4222-8222-222222222222";
  const ruleName = "E2E 自動出單修改 " + Date.now();
  let ruleId = "";
  let printWasEnabled: boolean | null = null;

  try {
    const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId }, select: { printModuleEnabled: true },
    });
    printWasEnabled = settings.printModuleEnabled;
    await prisma.stallOrderingSettings.update({
      where: { stallId }, data: { printModuleEnabled: true },
    });
    const printer = await prisma.printer.findFirstOrThrow({
      where: { organizationId, stallId, isEnabled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    ruleId = (await prisma.printRule.create({
      data: { organizationId, stallId, printerId: printer.id, name: ruleName },
      select: { id: true },
    })).id;

    await loginLocalTestAccount(page, "staff@stallorder.test", password);
    await gotoLocalPath(page, "/staff/" + stallSlug + "/print");

    const rulesSection = page
      .getByRole("heading", { name: "自動出單規則", exact: true })
      .locator("xpath=ancestor::section[1]");
    const ruleRow = rulesSection.locator("article").filter({ hasText: ruleName });
    await expect(ruleRow).toBeVisible();
    await ruleRow.getByRole("button", { name: "修改", exact: true }).click();

    const responsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/stalls/" + stallSlug + "/print-jobs"
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.operation === "UPDATE_RULE"
    ));
    await rulesSection.getByRole("button", { name: "儲存", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    const command = response.request().postDataJSON() as {
      operation: string;
      ruleId: string;
      rule: Record<string, unknown>;
    };
    expect(command.operation).toBe("UPDATE_RULE");
    expect(command.ruleId).toBe(ruleId);
    expect(command.rule).not.toHaveProperty("organizationId");
    expect(command.rule).not.toHaveProperty("stallId");
    expect(command.rule).not.toHaveProperty("deletedAt");
    expect(command.rule).not.toHaveProperty("createdAt");
    expect(command.rule).not.toHaveProperty("updatedAt");
    await expect(page.getByRole("dialog", { name: "操作已完成" })).toContainText("出單規則已儲存");
  } finally {
    if (ruleId) await prisma.printRule.deleteMany({ where: { id: ruleId } });
    if (printWasEnabled !== null) await prisma.stallOrderingSettings.update({
      where: { stallId }, data: { printModuleEnabled: printWasEnabled },
    });
    await prisma.$disconnect();
  }
});

function assertLocalDatabase() {
  assertResponsiveQaMode(process.env);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E 測試需要設定 DATABASE_URL。");
  const hostname = new URL(databaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("拒絕對非本機資料庫執行 E2E：" + hostname);
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
