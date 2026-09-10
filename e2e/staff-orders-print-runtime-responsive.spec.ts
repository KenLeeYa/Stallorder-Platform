import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  dismissStaffStartReminder,
  gotoLocalPath,
  loginLocalTestAccount,
} from "./local-navigation";

const password = "StallOrderDemo!2026";
const stallSlug = "aming-chicken";

test.use({ serviceWorkers: "block" });

const responsivePrisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let responsiveOrderId = "";
let responsiveOrderNo = "";

test.beforeAll(async () => {
  loadLocalEnv();
  assertLocalDatabase();
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
  await responsivePrisma.$disconnect();
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

  try {
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
    await prisma.$disconnect();
  }
});

function assertLocalDatabase() {
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
