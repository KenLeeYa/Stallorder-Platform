import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
let orderId = "";
let orderNo = "";
let productName = "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/auth/login")
    && candidate.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.waitForURL((url) => url.pathname !== "/login", { waitUntil: "load", timeout: 30_000 });
}

async function waitForReactHydration(control: Locator) {
  await expect.poll(() => control.evaluate((element) => (
    Object.keys(element).some((key) => (
      key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")
    ))
  )), { message: "等待 React 完成控制項 hydration" }).toBe(true);
}

test.beforeAll(async () => {
  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId, stallProducts: { some: { stallId, isEnabled: true } } },
    select: { id: true, name: true },
  });
  const unique = randomUUID();
  const order = await prisma.order.create({
    data: {
      organizationId,
      stallId,
      orderNo: `KDS-${Date.now().toString().slice(-6)}`,
      trackingTokenHash: createHash("sha256").update(unique).digest("hex"),
      idempotencyKey: randomUUID(),
      source: "QR_MENU",
      isTest: true,
      customerName: "KDS QA 顧客",
      fulfillmentType: "TAKEOUT",
      status: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID",
      subtotal: 95,
      total: 95,
      deviceHash: createHash("sha256").update(`device-${unique}`).digest("hex"),
      pickupCodeHash: createHash("sha256").update("738").digest("hex"),
      pickupCodeDisplay: "738",
      confirmationExpiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  orderId = order.id;
  orderNo = order.orderNo;
  productName = product.name;
  await prisma.orderItem.create({
    data: {
      organizationId,
      stallId,
      orderId,
      productId: product.id,
      name: product.name,
      baseUnitPrice: 95,
      unitPrice: 95,
      quantity: 2,
      note: "切小塊",
    },
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { status: "CONFIRMED", confirmedAt: new Date(Date.now() - 6 * 60_000) },
  });
});

test.afterAll(async () => {
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.$disconnect();
});

test("KDS 即時事件流使用獨立權限邊界", async ({ page }) => {
  await login(page, "kitchen@stallorder.test");
  await expect(page).toHaveURL(/\/kitchen\?stall=aming-chicken/);
  await expect(page.getByText("即時連線", { exact: true })).toBeVisible();
  const generalStreamStatus = await page.evaluate(async () => (
    await fetch("/api/stalls/aming-chicken/orders/stream", { cache: "no-store" })
  ).status);
  expect(generalStreamStatus).toBe(403);
});

test("廚房角色可在手機 KDS 操作且只取得安全欄位", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const sentinel = new EventTarget() as EventTarget & { release: () => Promise<void> };
    sentinel.release = async () => {
      sentinel.dispatchEvent(new Event("release"));
    };
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => sentinel },
    });
  });
  let blockKitchenStream = true;
  await page.route("**/api/stalls/*/kitchen/stream", (route) => (
    blockKitchenStream ? route.abort() : route.continue()
  ));
  await login(page, "kitchen@stallorder.test");
  await expect(page).toHaveURL(/\/kitchen\?stall=aming-chicken/);
  await expect(page.getByRole("heading", { name: "廚房生產系統" })).toBeAttached();
  const navigation = page.locator('[data-testid="kitchen-primary-navigation"]:visible').last();
  const header = page.locator("header:visible").filter({ has: navigation }).last();
  await expect(navigation).toBeVisible();
  expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
  const navigationTargets = await navigation.locator('a, button, [role="status"]').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  expect(navigationTargets.every(({ width, height }) => width >= 40 && height >= 40)).toBe(true);
  await expect(page.getByText("輪詢同步", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("kitchen-toolbar-mobile.png"), fullPage: false });
  const soundButton = header.getByTitle("開啟新單提示音");
  await expect(soundButton).toBeVisible();
  await soundButton.click();
  await expect(header.getByTitle("關閉新單提示音")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("stallorder_kitchen_order_alerts"))).toBe("enabled");
  const wakeButton = header.getByTitle("開啟螢幕保持喚醒");
  await expect(wakeButton).toBeVisible();
  await wakeButton.click();
  await expect(header.getByTitle("關閉螢幕保持喚醒")).toBeVisible();
  const refreshResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/kitchen/board")
    && response.request().method() === "GET"
  ));
  await header.getByTitle("重新整理").click();
  expect((await refreshResponse).status()).toBe(200);
  await expect(header.getByTitle("登出")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  blockKitchenStream = false;
  await expect(page.getByText("即時連線", { exact: true })).toBeVisible({ timeout: 10_000 });
  const orderCard = page.getByRole("article").filter({ hasText: "#" + orderNo });
  await expect(orderCard.getByText("等候警示", { exact: true })).toBeVisible();
  await expect(orderCard.getByText("取餐 738", { exact: true })).toBeVisible();
  await expect(orderCard.getByText("備註：切小塊", { exact: true })).toBeVisible();

  const safePayload = await page.evaluate(async () => {
    const response = await fetch("/api/stalls/aming-chicken/kitchen/board", { cache: "no-store" });
    if (!response.ok) throw new Error("KDS board request failed");
    return response.json();
  });
  const serialized = JSON.stringify(safePayload);
  for (const forbidden of ["customerPhone", "deliveryAddress", "paymentStatus", "subtotal", "discountAmount", "total"]) {
    expect(serialized).not.toContain(`\"${forbidden}\"`);
  }

  const generalOrderStatus = await page.evaluate(async () => (
    await fetch("/api/stalls/aming-chicken/orders", { cache: "no-store" })
  ).status);
  expect(generalOrderStatus).toBe(403);

  await page.getByRole("button", { name: "品項", exact: true }).click();
  const itemAggregate = page.getByRole("article")
    .filter({ hasText: productName })
    .filter({ hasText: "切小塊" });
  await expect(itemAggregate).toBeVisible();
  await expect(itemAggregate.getByText(/^× \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "工作站", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "工作站", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "訂單", exact: true }).click();

  const taskResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/kitchen/tasks")
    && response.request().method() === "PATCH"
  ));
  await orderCard.getByRole("button", { name: "開始製作", exact: true }).click();
  expect((await taskResponse).status()).toBe(200);
  await expect(orderCard.getByText("製作中", { exact: true })).toBeVisible();

  await page.goto(`/merchant/stalls/${stallId}/kitchen/stations`);
  await expect(page.getByRole("heading", { name: "找不到此頁面", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工作站與品項分流" })).toHaveCount(0);
  await page.goto("/kitchen?stall=aming-chicken");
  await page.locator("header:visible").filter({ has: page.locator('[data-testid="kitchen-primary-navigation"]:visible') }).last().getByTitle("登出").click();
  await expect(page).toHaveURL(/\/login$/);
});

test("廚房訂單模式在手機堆疊並於平板桌機使用三區工作台", async ({ page }) => {
  await login(page, "kitchen@stallorder.test");

  for (const viewport of [
    { name: "compact-mobile", width: 320, height: 568 },
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/kitchen?stall=aming-chicken");

    const mainContent = page.locator("#main-content");
    const workspace = mainContent.getByTestId("kitchen-order-workspace");
    const queue = mainContent.getByTestId("kitchen-order-queue-pane");
    const items = mainContent.getByTestId("kitchen-order-items-pane");
    const actions = mainContent.getByTestId("kitchen-order-actions-pane");
    await expect(workspace, `${viewport.name} workspace`).toBeVisible();
    await expect(queue, `${viewport.name} queue`).toBeVisible();
    await expect(items, `${viewport.name} items`).toBeVisible();
    await expect(actions, `${viewport.name} actions`).toBeVisible();
    await expect(workspace.getByTestId("kitchen-order-queue-button").first()).toBeVisible();

    const layout = await workspace.evaluate((element) => {
      const box = (testId: string) => {
        const target = element.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
        const bounds = target.getBoundingClientRect();
        return {
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          top: Math.round(bounds.top),
          bottom: Math.round(bounds.bottom),
          overflowY: getComputedStyle(target).overflowY,
        };
      };
      return {
        queue: box("kitchen-order-queue-pane"),
        items: box("kitchen-order-items-pane"),
        actions: box("kitchen-order-actions-pane"),
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout.queue.overflowY).toBe("auto");
    expect(layout.items.overflowY).toBe("auto");
    expect(layout.actions.overflowY).toBe("auto");
    expect(layout.scrollWidth, `${viewport.name} page overflow`).toBeLessThanOrEqual(layout.clientWidth + 1);
    if (viewport.width >= 768) {
      expect(layout.queue.right, `${viewport.name} queue before items`).toBeLessThanOrEqual(layout.items.left);
      expect(layout.items.right, `${viewport.name} items before actions`).toBeLessThanOrEqual(layout.actions.left);
      expect(layout.queue.top, `${viewport.name} aligned top`).toBeCloseTo(layout.items.top, 0);
      expect(layout.items.top, `${viewport.name} aligned actions`).toBeCloseTo(layout.actions.top, 0);
    } else {
      expect(layout.queue.bottom, `${viewport.name} queue stacks first`).toBeLessThanOrEqual(layout.items.top);
      expect(layout.items.bottom, `${viewport.name} actions stack last`).toBeLessThanOrEqual(layout.actions.top);
    }

    const touchTargets = await workspace.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    expect(touchTargets.every(({ height }) => height >= 44), `${viewport.name} 44px controls`).toBe(true);
    await expect(workspace.getByText("結帳收款", { exact: true })).toHaveCount(0);
  }
});

test("攤位管理者可進入工作站與 KDS 設定", async ({ page }) => {
  await login(page, "owner@stallorder.test");
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/kitchen?stall=aming-chicken");
  const orderCard = page.getByRole("article").filter({ hasText: `#${orderNo}` });
  const cancelButton = orderCard.getByRole("button", { name: "取消", exact: true });
  await cancelButton.focus();
  await cancelButton.click();
  const cancellationDialog = page.getByRole("alertdialog", { name: `取消訂單 ${orderNo}？` });
  await expect(cancellationDialog).toBeVisible();
  await expect(cancellationDialog.getByText("此操作無法復原", { exact: true })).toBeVisible();
  await expect(cancellationDialog.getByText(/停止此訂單的所有廚房工作/)).toBeVisible();
  await expect(cancellationDialog.getByRole("button", { name: "返回", exact: true })).toBeFocused();
  await expect(cancellationDialog.getByLabel("取消原因")).toHaveValue("SOLD_OUT");
  const dialogLayout = await cancellationDialog.evaluate((element) => {
    const scrollRegion = element.querySelector("form")!;
    return {
      dialogWidth: element.clientWidth,
      dialogScrollWidth: element.scrollWidth,
      clientHeight: scrollRegion.clientHeight,
      scrollHeight: scrollRegion.scrollHeight,
      viewportHeight: window.innerHeight,
    };
  });
  expect(dialogLayout.dialogScrollWidth).toBeLessThanOrEqual(dialogLayout.dialogWidth);
  expect(dialogLayout.clientHeight).toBeLessThanOrEqual(dialogLayout.viewportHeight - 16);
  expect(dialogLayout.scrollHeight).toBeGreaterThan(dialogLayout.clientHeight);

  await cancellationDialog.getByLabel("取消原因").selectOption("OTHER");
  await cancellationDialog.getByRole("button", { name: "確認取消", exact: true }).click();
  const detailInput = cancellationDialog.getByLabel("補充說明（必填）");
  await expect(cancellationDialog.getByText("選擇其他原因時，請填寫補充說明。", { exact: true })).toBeVisible();
  await expect(detailInput).toBeFocused();
  await detailInput.fill("KDS E2E 僅驗證介面，不送出取消");
  const confirmationInput = cancellationDialog.getByLabel("確認訂單編號");
  await confirmationInput.fill("WRONG-ORDER");
  await cancellationDialog.getByRole("button", { name: "確認取消", exact: true }).click();
  await expect(cancellationDialog.getByText(`請完整輸入訂單編號 ${orderNo}。`, { exact: true })).toBeVisible();
  await expect(confirmationInput).toBeFocused();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status).not.toBe("CANCELLED");

  await page.keyboard.press("Escape");
  await expect(cancellationDialog).toBeHidden();
  await expect(cancelButton).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await cancelButton.click();
  await expect(cancellationDialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await cancellationDialog.getByRole("button", { name: "返回", exact: true }).click();
  await expect(cancellationDialog).toBeHidden();
  await expect(cancelButton).toBeFocused();

  await cancelButton.click();
  await cancellationDialog.getByLabel("取消原因").selectOption("OTHER");
  await cancellationDialog.getByLabel("補充說明（必填）").fill("KDS E2E 完整取消流程");
  await cancellationDialog.getByLabel("確認訂單編號").fill(orderNo);
  const cancellationResponse = page.waitForResponse((response) => (
    response.url().endsWith(`/api/stalls/aming-chicken/orders/${orderId}`)
    && response.request().method() === "PATCH"
  ));
  await cancellationDialog.getByRole("button", { name: "確認取消", exact: true }).click();
  expect((await cancellationResponse).status()).toBe(200);
  await expect(cancellationDialog).toBeHidden();
  await expect(orderCard).toHaveCount(0);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status).toBe("CANCELLED");

  await page.goto("/kitchen/stations?stall=aming-chicken");
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/kitchen/stations\\?source=kitchen$`));
  await expect(page.getByRole("button", { name: "返回生產看板", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工作站與品項分流" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "綜合工作站", exact: true }).last()).toBeVisible();
  const createStationButton = page.getByRole("button", { name: "新增工作站", exact: true });
  await waitForReactHydration(createStationButton);
  const newStationName = page.getByLabel("名稱", { exact: true }).first();
  const newStationCode = page.getByLabel("代碼", { exact: true }).first();
  await newStationName.fill("錯誤代碼測試");
  await newStationCode.fill("中文代碼");
  const invalidStationResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/kitchen/stations")
    && response.request().method() === "PATCH"
  ));
  await createStationButton.click();
  expect((await invalidStationResponse).status()).toBe(400);
  await expect(newStationCode).toHaveAttribute("aria-invalid", "true");
  await expect(newStationCode).toBeFocused();
  await page.goto("/kitchen/settings?stall=aming-chicken");
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}/kitchen/settings\\?source=kitchen$`));
  await expect(page.getByRole("button", { name: "返回生產看板", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "KDS 顯示設定" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "警示時間（分鐘）", exact: true }).last()).toHaveValue("5");
  await expect(page.getByRole("spinbutton", { name: "嚴重逾時（分鐘）", exact: true }).last()).toHaveValue("10");
  const saveSettingsButton = page.getByRole("button", { name: "儲存設定", exact: true });
  await waitForReactHydration(saveSettingsButton);
  const warningMinutes = page.getByRole("spinbutton", { name: "警示時間（分鐘）", exact: true }).last();
  const criticalMinutes = page.getByRole("spinbutton", { name: "嚴重逾時（分鐘）", exact: true }).last();
  await warningMinutes.fill("10");
  await expect(warningMinutes).toHaveValue("10");
  await criticalMinutes.fill("8");
  await expect(criticalMinutes).toHaveValue("8");
  await expect(warningMinutes).toHaveValue("10");
  const invalidSettingsResponse = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/kitchen/settings")
    && response.request().method() === "PATCH"
  ));
  await saveSettingsButton.click();
  expect((await invalidSettingsResponse).status()).toBe(400);
  await expect(criticalMinutes).toHaveAttribute("aria-invalid", "true");
  await expect(criticalMinutes).toBeFocused();

  await page.goto(`/merchant/stalls/${stallId}/kitchen/settings?source=https://attacker.invalid`);
  const fallbackButton = page.getByRole("button", { name: "返回攤位設定", exact: true });
  await expect(fallbackButton).toBeVisible();
  await waitForReactHydration(fallbackButton);
  await fallbackButton.click();
  await expect(page).toHaveURL(new RegExp(`/merchant/stalls/${stallId}$`));
});
