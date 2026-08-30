import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildFulfillmentTimeSlots } from "../src/lib/fulfillment-time-options";
import { dismissStaffStartReminder } from "./local-navigation";

const prisma = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
const createdOrderIds: string[] = [];
let originalDeliveryEnabled = false;
let originalStaffDeliveryEnabled = false;
let originalDineInEnabled = false;
let originalTakeoutPreorderEnabled = false;
let cashShiftId = "";
type AuthCookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
let ownerAuthCookies: AuthCookies | null = null;

async function login(page: Page) {
  if (ownerAuthCookies) {
    await page.context().addCookies(ownerAuthCookies);
    await page.goto("/merchant/dashboard");
    await expect(page).toHaveURL(/\/merchant\/dashboard(?:\?organizationId=|$)/, { timeout: 30_000 });
    return;
  }
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill("owner@stallorder.test");
  await page.getByLabel("密碼").fill("StallOrderDemo!2026");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard(?:\?organizationId=|$)/, { timeout: 30_000 });
  ownerAuthCookies = await page.context().cookies();
}

test.beforeAll(async () => {
  const [settings, owner] = await Promise.all([
    prisma.stallOrderingSettings.findUniqueOrThrow({
      where: { stallId },
      select: {
        deliveryModuleEnabled: true,
        staffDeliveryEnabled: true,
        dineInEnabled: true,
        takeoutPreorderEnabled: true,
      },
    }),
    prisma.profile.findUniqueOrThrow({ where: { email: "owner@stallorder.test" }, select: { id: true } }),
  ]);
  originalDeliveryEnabled = settings.deliveryModuleEnabled;
  originalStaffDeliveryEnabled = settings.staffDeliveryEnabled;
  originalDineInEnabled = settings.dineInEnabled;
  originalTakeoutPreorderEnabled = settings.takeoutPreorderEnabled;
  await prisma.stallOrderingSettings.update({
    where: { stallId },
    data: {
      deliveryModuleEnabled: true,
      staffDeliveryEnabled: true,
      dineInEnabled: true,
      takeoutPreorderEnabled: true,
    },
  });
  const shift = await prisma.cashShift.create({
    data: {
      organizationId: "11111111-1111-4111-8111-111111111111",
      stallId,
      openingAmount: 0,
      openedById: owner.id,
      note: "Staff POS E2E 班次",
    },
  });
  cashShiftId = shift.id;
});

test.afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  if (cashShiftId) {
    await prisma.cashShiftReview.deleteMany({ where: { cashShiftId } });
    await prisma.cashShift.deleteMany({ where: { id: cashShiftId } });
  }
  await prisma.stallOrderingSettings.update({
    where: { stallId },
    data: {
      deliveryModuleEnabled: originalDeliveryEnabled,
      staffDeliveryEnabled: originalStaffDeliveryEnabled,
      dineInEnabled: originalDineInEnabled,
      takeoutPreorderEnabled: originalTakeoutPreorderEnabled,
    },
  });
  await prisma.$disconnect();
});

test("內用顧客名稱與桌位欄位在桌面版對齊", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await login(page);
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  const staffMain = page.getByRole("main");
  await expect(staffMain).toHaveCount(1);
  const functionGrid = staffMain.getByTestId("staff-function-grid");
  await expect(functionGrid).toHaveCount(1);
  await expect(functionGrid).toBeVisible();
  expect(await functionGrid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { display: style.display, flexWrap: style.flexWrap, overflowY: style.overflowY };
  })).toEqual({ display: "flex", flexWrap: "nowrap", overflowY: "visible" });
  const desktopFunctionPositions = await functionGrid.locator(":scope > *").evaluateAll((elements) => (
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y };
    })
  ));
  expect(desktopFunctionPositions.length).toBeLessThanOrEqual(12);
  expect(desktopFunctionPositions.every(({ y }) => Math.abs(y - desktopFunctionPositions[0]!.y) <= 1)).toBe(true);
  expect(desktopFunctionPositions.every(({ x }, index) => index === 0 || x > desktopFunctionPositions[index - 1]!.x)).toBe(true);
  await functionGrid.getByTitle("離線裝置", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "離線裝置", exact: true })).toBeVisible();
  await page.getByTitle("關閉離線裝置視窗", { exact: true }).click();
  const configurationResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/api/stalls/aming-chicken/pos-configuration")
    && response.request().method() === "GET"
  ));
  await page.getByRole("button", { name: "店員點餐" }).click();
  expect((await configurationResponsePromise).status()).toBe(200);

  const dialog = page.getByRole("dialog", { name: "店員點餐" });
  await expect(dialog.getByRole("region", { name: "結帳折扣" })).toBeVisible();
  const menuPanel = dialog.getByTestId("staff-order-menu-panel");
  const cartPanel = dialog.getByTestId("staff-order-cart-panel");
  const cartLines = dialog.getByTestId("staff-order-cart-lines");
  const checkoutControls = dialog.getByTestId("staff-order-checkout-controls");
  const groupNavigation = dialog.getByTestId("staff-group-navigation");
  await expect(groupNavigation).toBeVisible();
  expect(await groupNavigation.evaluate((element) => window.getComputedStyle(element).position)).toBe("sticky");
  expect(await menuPanel.evaluate((element) => window.getComputedStyle(element).overflowY)).toBe("auto");
  expect(await cartPanel.evaluate((element) => window.getComputedStyle(element).overflowY)).toBe("hidden");
  expect(await cartLines.evaluate((element) => window.getComputedStyle(element).overflowY)).toBe("auto");
  expect(await checkoutControls.evaluate((element) => window.getComputedStyle(element).flexShrink)).toBe("0");
  const catalogToggle = dialog.getByTestId("staff-product-list-toggle");
  await expect(catalogToggle).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByTestId("staff-product-list")).toBeVisible();
  const friedGroup = dialog.locator('[data-testid="staff-product-group"][data-category="炸物"]');
  const drinkGroup = dialog.locator('[data-testid="staff-product-group"][data-category="飲料"]');
  await expect(friedGroup).toBeVisible();
  await expect(drinkGroup).toBeVisible();
  const cartPositionBeforeCategoryJump = await cartPanel.boundingBox();
  await groupNavigation.getByRole("link", { name: "清涼飲品", exact: true }).click();
  await expect.poll(async () => menuPanel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const cartPositionAfterCategoryJump = await cartPanel.boundingBox();
  expect(cartPositionBeforeCategoryJump).not.toBeNull();
  expect(cartPositionAfterCategoryJump).not.toBeNull();
  expect(Math.abs(cartPositionAfterCategoryJump!.y - cartPositionBeforeCategoryJump!.y)).toBeLessThanOrEqual(1);
  await friedGroup.getByRole("button", { name: "收合商品群組 人氣炸物", exact: true }).click();
  await expect(friedGroup.getByRole("button", { name: "展開商品群組 人氣炸物", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(friedGroup.getByTestId("staff-product-card")).toHaveCount(0);
  await expect(drinkGroup.getByTestId("staff-product-card").first()).toBeVisible();
  await catalogToggle.click();
  await expect(catalogToggle).toHaveAttribute("aria-expanded", "false");
  await expect(catalogToggle).toHaveText("展開全部商品");
  await expect(dialog.getByTestId("staff-product-list")).toHaveCount(0);
  await catalogToggle.click();
  await expect(catalogToggle).toHaveAttribute("aria-expanded", "true");
  await expect(catalogToggle).toHaveText("收合全部商品");
  await expect(dialog.getByTestId("staff-product-list")).toBeVisible();
  await expect(friedGroup.getByRole("button", { name: "收合商品群組 人氣炸物", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(friedGroup.getByTestId("staff-product-card").first()).toBeVisible();
  await dialog.getByRole("button", { name: "內用", exact: true }).click();
  const customerNameInput = dialog.getByLabel("顧客名稱（選填）");
  const tableSelect = dialog.getByLabel("桌位");
  const [customerBox, tableBox] = await Promise.all([
    customerNameInput.boundingBox(),
    tableSelect.boundingBox(),
  ]);

  expect(customerBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(Math.abs(customerBox!.y - tableBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(customerBox!.height - tableBox!.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("staff-pos-dine-in-alignment.png"), fullPage: true });
});

test("店員內用與外送使用獨立設定，且建立訂單時重新驗證", async ({ page }) => {
  await prisma.stallOrderingSettings.update({
    where: { stallId },
    data: {
      deliveryModuleEnabled: false,
      staffDeliveryEnabled: true,
      dineInEnabled: true,
    },
  });

  try {
    await page.setViewportSize({ width: 1024, height: 900 });
    await login(page);
    await page.goto("/staff/aming-chicken");
    await dismissStaffStartReminder(page);
    const initialConfigurationPromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/api/stalls/aming-chicken/pos-configuration")
      && response.request().method() === "GET"
    ));
    await page.getByRole("button", { name: "店員點餐" }).click();
    const initialConfiguration = await initialConfigurationPromise;
    expect(initialConfiguration.status()).toBe(200);
    expect((await initialConfiguration.json()).modules).toMatchObject({
      dineIn: true,
      delivery: true,
    });

    const dialog = page.getByRole("dialog", { name: "店員點餐" });
    const dineInButton = dialog.getByRole("button", { name: "內用", exact: true });
    const deliveryButton = dialog.getByRole("button", { name: "外送", exact: true });
    await expect(dineInButton).toBeEnabled();
    await expect(deliveryButton).toBeEnabled();
    await deliveryButton.click();
    await expect(dialog.getByLabel("聯絡電話（選填）", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("地址（選填）", { exact: true })).toHaveValue("");
    await dialog.getByTitle(/^增加 /).first().click();
    const fieldsets = dialog.locator("fieldset");
    for (let index = 0; index < await fieldsets.count(); index += 1) {
      const fieldset = fieldsets.nth(index);
      if ((await fieldset.locator("legend").innerText()).includes("*")) {
        await fieldset.locator('input[type="radio"], input[type="checkbox"]').first().check();
      }
    }
    await dialog.getByRole("button", { name: "加入購物車", exact: true }).click();
    await dialog.getByRole("button", { name: "稍後結帳", exact: true }).click();

    await prisma.stallOrderingSettings.update({
      where: { stallId },
      data: { deliveryModuleEnabled: true, staffDeliveryEnabled: false },
    });
    const rejectedDeliveryPromise = page.waitForResponse((response) => (
      response.url().endsWith("/api/stalls/aming-chicken/orders")
      && response.request().method() === "POST"
    ));
    await dialog.getByRole("button", { name: "建立訂單送入廚房", exact: true }).click();
    const rejectedDelivery = await rejectedDeliveryPromise;
    expect(rejectedDelivery.status()).toBe(400);
    expect(await rejectedDelivery.json()).toMatchObject({ code: "DELIVERY_UNAVAILABLE" });

    await dineInButton.click();
    await expect(dialog.getByLabel("桌位")).toBeVisible();
    await prisma.stallOrderingSettings.update({
      where: { stallId },
      data: { dineInEnabled: false },
    });
    const rejectedDineInPromise = page.waitForResponse((response) => (
      response.url().endsWith("/api/stalls/aming-chicken/orders")
      && response.request().method() === "POST"
    ));
    await dialog.getByRole("button", { name: "建立訂單送入廚房", exact: true }).click();
    const rejectedDineIn = await rejectedDineInPromise;
    expect(rejectedDineIn.status()).toBe(400);
    expect(await rejectedDineIn.json()).toMatchObject({ code: "TABLE_UNAVAILABLE" });

    await dialog.getByTitle("關閉店員點餐").click();
    await prisma.stallOrderingSettings.update({
      where: { stallId },
      data: {
        deliveryModuleEnabled: true,
        staffDeliveryEnabled: false,
        dineInEnabled: true,
      },
    });
    const refreshedConfigurationPromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/api/stalls/aming-chicken/pos-configuration")
      && response.request().method() === "GET"
    ));
    await page.getByRole("button", { name: "店員點餐" }).click();
    const refreshedConfiguration = await refreshedConfigurationPromise;
    expect(refreshedConfiguration.status()).toBe(200);
    expect((await refreshedConfiguration.json()).modules).toMatchObject({
      dineIn: true,
      delivery: false,
    });
    const refreshedDialog = page.getByRole("dialog", { name: "店員點餐" });
    await expect(refreshedDialog.getByRole("button", { name: "內用", exact: true })).toBeEnabled();
    await expect(refreshedDialog.getByRole("button", { name: "外送", exact: true })).toBeDisabled();
  } finally {
    await prisma.stallOrderingSettings.update({
      where: { stallId },
      data: {
        deliveryModuleEnabled: true,
        staffDeliveryEnabled: true,
        dineInEnabled: true,
      },
    });
  }
});

test("店員可在手機介面代客點餐並立即完成收款", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  const staffMain = page.getByRole("main");
  await expect(staffMain).toHaveCount(1);
  const functionGrid = staffMain.getByTestId("staff-function-grid");
  await expect(functionGrid).toHaveCount(1);
  await expect(functionGrid).toBeVisible();
  expect(await functionGrid.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { display: style.display, flexWrap: style.flexWrap, overflowX: style.overflowX };
  })).toEqual({ display: "flex", flexWrap: "nowrap", overflowX: "auto" });
  expect(await functionGrid.locator(":scope > [data-testid^='staff-function-']").count()).toBe(4);
  expect(await functionGrid.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await functionGrid.locator(":scope > *").count()).toBeLessThanOrEqual(12);
  const [staffOrderBox, floorPlanBox] = await Promise.all([
    functionGrid.getByRole("button", { name: "店員點餐", exact: true }).boundingBox(),
    functionGrid.getByRole("link", { name: "桌位平面圖", exact: true }).boundingBox(),
  ]);
  expect(staffOrderBox).not.toBeNull();
  expect(floorPlanBox).not.toBeNull();
  expect(Math.abs(staffOrderBox!.width - floorPlanBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(staffOrderBox!.height - floorPlanBox!.height)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "店員點餐" })).toBeVisible();
  const configurationResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/api/stalls/aming-chicken/pos-configuration")
    && response.request().method() === "GET"
  ));
  await page.getByRole("button", { name: "店員點餐" }).click();
  const configurationResponse = await configurationResponsePromise;
  expect(configurationResponse.status()).toBe(200);
  const configuration = await configurationResponse.json() as {
    catalog: { fulfillmentSlots: string[] };
  };
  const fulfillmentTimeSlots = buildFulfillmentTimeSlots(
    configuration.catalog.fulfillmentSlots,
    "Asia/Taipei",
  );
  const targetPickupSlot = fulfillmentTimeSlots.at(-1);
  if (!targetPickupSlot) throw new Error("店員指定時間 E2E 找不到 5 分鐘單位的可用時段。");

  const dialog = page.getByRole("dialog", { name: "店員點餐" });
  await expect(dialog).toBeVisible();
  const groupNavigation = dialog.getByTestId("staff-group-navigation");
  const menuPanel = dialog.getByTestId("staff-order-menu-panel");
  await expect(groupNavigation).toBeVisible();
  expect(await groupNavigation.evaluate((element) => window.getComputedStyle(element).position)).toBe("sticky");
  await expect(dialog.locator('[data-testid="staff-product-group"][data-category="炸物"]')).toBeVisible();
  await expect(dialog.locator('[data-testid="staff-product-group"][data-category="飲料"]')).toBeVisible();
  await groupNavigation.getByRole("link", { name: "清涼飲品", exact: true }).click();
  await expect.poll(async () => menuPanel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole("radio", { name: "儘快，不指定時間" })).toBeChecked();
  await expect(dialog.getByTestId("staff-takeout-fulfillment-time-fields")).toHaveCount(0);
  await dialog.getByRole("radio", { name: "指定取餐時間" }).check();

  const pickupFields = dialog.getByTestId("staff-takeout-fulfillment-time-fields");
  const pickupDate = pickupFields.getByLabel("取餐日期");
  const pickupHour = pickupFields.getByLabel("取餐時間－時");
  const pickupMinute = pickupFields.getByLabel("取餐時間－分");
  await expect(pickupDate).toHaveAttribute("type", "date");
  await expect(pickupDate).toHaveAttribute("min", fulfillmentTimeSlots[0]!.date);
  await expect(pickupDate).toHaveAttribute("max", fulfillmentTimeSlots.at(-1)!.date);
  for (const [label, control] of [
    ["取餐日期", pickupDate],
    ["時", pickupHour],
    ["分", pickupMinute],
  ] as const) {
    await expect(control, `${label}欄位應顯示`).toBeVisible();
    expect((await control.boundingBox())?.height ?? 0, `${label}欄位應至少 44px`).toBeGreaterThanOrEqual(44);
  }
  await pickupDate.fill(targetPickupSlot.date);
  await pickupHour.selectOption(targetPickupSlot.hour);
  await pickupMinute.selectOption(targetPickupSlot.minute);
  await expect(pickupDate).toHaveValue(targetPickupSlot.date);
  await expect(pickupHour).toHaveValue(targetPickupSlot.hour);
  await expect(pickupMinute).toHaveValue(targetPickupSlot.minute);
  expect(await pickupHour.locator("option").allTextContents()).toEqual(
    expect.arrayContaining([targetPickupSlot.hour]),
  );
  expect((await pickupHour.locator("option").allTextContents()).every((hour) => (
    /^(?:[01]\d|2[0-3])$/.test(hour)
  ))).toBe(true);
  expect(await pickupMinute.locator("option").allTextContents()).toEqual(
    expect.arrayContaining([targetPickupSlot.minute]),
  );
  expect((await pickupMinute.locator("option").allTextContents()).every((minute) => (
    /^(?:[0-5]\d)$/.test(minute) && Number(minute) % 5 === 0
  ))).toBe(true);

  await dialog.getByRole("button", { name: "外送", exact: true }).click();
  await expect(dialog.getByTestId("staff-takeout-fulfillment-time-fields")).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "儘快，不指定時間" })).toBeChecked();
  await dialog.getByRole("radio", { name: "指定送達時間" }).check();
  const deliveryFields = dialog.getByTestId("staff-delivery-fulfillment-time-fields");
  const deliveryDate = deliveryFields.getByLabel("送達日期");
  const deliveryHour = deliveryFields.getByLabel("送達時間－時");
  const deliveryMinute = deliveryFields.getByLabel("送達時間－分");
  for (const [label, control] of [
    ["送達日期", deliveryDate],
    ["送達時間－時", deliveryHour],
    ["送達時間－分", deliveryMinute],
  ] as const) {
    await expect(control, `${label}欄位應顯示`).toBeVisible();
    expect((await control.boundingBox())?.height ?? 0, `${label}欄位應至少 44px`).toBeGreaterThanOrEqual(44);
  }
  await deliveryDate.fill(targetPickupSlot.date);
  await deliveryHour.selectOption(targetPickupSlot.hour);
  await deliveryMinute.selectOption(targetPickupSlot.minute);
  await expect(deliveryMinute).toHaveValue(targetPickupSlot.minute);

  await dialog.getByRole("button", { name: "外帶自取", exact: true }).click();
  await expect(dialog.getByTestId("staff-delivery-fulfillment-time-fields")).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "儘快，不指定時間" })).toBeChecked();
  await dialog.getByRole("radio", { name: "指定取餐時間" }).check();
  const resetPickupFields = dialog.getByTestId("staff-takeout-fulfillment-time-fields");
  await resetPickupFields.getByLabel("取餐日期").fill(targetPickupSlot.date);
  await resetPickupFields.getByLabel("取餐時間－時").selectOption(targetPickupSlot.hour);
  await resetPickupFields.getByLabel("取餐時間－分").selectOption(targetPickupSlot.minute);

  const firstIncrease = dialog.getByTitle(/^增加 /).first();
  const selectedProductName = (await firstIncrease.getAttribute("title"))?.replace(/^增加 /, "");
  if (!selectedProductName) throw new Error("店員點餐測試找不到第一個商品名稱。");
  await firstIncrease.click();
  const fieldsets = dialog.locator("fieldset");
  for (let index = 0; index < await fieldsets.count(); index += 1) {
    const fieldset = fieldsets.nth(index);
    if ((await fieldset.locator("legend").innerText()).includes("*")) {
      await fieldset.locator('input[type="radio"], input[type="checkbox"]').first().check();
    }
  }
  const addToCart = dialog.getByRole("button", { name: "加入購物車", exact: true });
  await expect.poll(async () => (await addToCart.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await addToCart.click();
  const draftCustomerName = `現場暫存 ${Date.now()}`;
  const draftCustomerPhone = "0912345678";
  const draftCustomerNote = `敏感備註 ${Date.now()}`;
  await dialog.getByLabel("顧客名稱（選填）").fill(draftCustomerName);
  await dialog.getByLabel("聯絡電話（選填）").fill(draftCustomerPhone);
  await dialog.getByTestId("staff-order-cart-tab").click();
  const draftCartPanel = dialog.getByTestId("staff-order-cart-panel");
  await expect(draftCartPanel).toBeVisible();
  await draftCartPanel.getByTestId("staff-tablet-confirm-order").click();
  await draftCartPanel.getByTestId("staff-checkout-note-button").click();
  const noteDialog = page.getByRole("dialog", { name: "整單備註", exact: true });
  await noteDialog.locator("textarea").fill(draftCustomerNote);
  await noteDialog.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(noteDialog).toBeHidden();
  await draftCartPanel.getByTestId("staff-checkout-back-icon").click();
  await dialog.getByTestId("staff-save-draft").click();
  await expect(dialog.getByRole("status")).toContainText("暫存在此裝置");
  await expect(dialog.getByTestId("staff-cart-line")).toHaveCount(0);
  const storedDraft = await page.evaluate(() => {
    const entry = Object.entries(window.localStorage).find(([key]) => key.startsWith("stallorder_staff_order_drafts:"));
    if (!entry) return null;
    const drafts = JSON.parse(entry[1]) as Array<{ label: string; cartDraft: string; managerPassword?: string; cashReceived?: string }>;
    return { count: drafts.length, first: drafts[0], raw: entry[1] };
  });
  expect(storedDraft).not.toBeNull();
  expect(storedDraft?.count).toBe(1);
  expect(storedDraft?.raw).not.toContain("managerPassword");
  expect(storedDraft?.raw).not.toContain("cashReceived");
  expect(storedDraft?.raw).not.toContain(draftCustomerName);
  expect(storedDraft?.raw).not.toContain(draftCustomerPhone);
  expect(storedDraft?.raw).not.toContain(draftCustomerNote);
  const storedCartDraft = JSON.parse(storedDraft?.first?.cartDraft ?? "{}") as {
    customerName?: string;
    customerPhone?: string;
    customerNote?: string;
    deliveryAddress?: string;
    lines?: Array<{ note?: string }>;
  };
  expect(storedCartDraft).toMatchObject({
    customerName: "",
    customerPhone: "",
    customerNote: "",
    deliveryAddress: "",
  });
  expect(storedCartDraft.lines?.every((line) => !line.note)).toBe(true);

  await dialog.getByTestId("staff-open-drafts").click();
  const draftManager = page.getByRole("dialog", { name: "此裝置的暫存訂單" });
  await expect(draftManager.getByTestId("staff-draft-card")).toHaveCount(1);
  await draftManager.getByRole("button", { name: "繼續點餐", exact: true }).click();
  await expect(dialog.getByLabel("顧客名稱（選填）")).toHaveValue("");
  await expect(dialog.getByLabel("聯絡電話（選填）")).toHaveValue("");
  await expect(dialog.getByTestId("staff-cart-line")).toHaveCount(1);

  await dialog.getByTestId("staff-open-drafts").click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("dialog", { name: "此裝置的暫存訂單" }).getByRole("button", { name: `刪除暫存單 ${storedDraft?.first?.label}` }).click();
  await expect(page.getByRole("dialog", { name: "此裝置的暫存訂單" }).getByTestId("staff-draft-card")).toHaveCount(0);
  await page.getByTitle("關閉暫存訂單").click();
  await dialog.getByTestId("staff-save-draft").click();
  await dialog.getByTestId("staff-open-drafts").click();
  await page.getByRole("dialog", { name: "此裝置的暫存訂單" }).getByRole("button", { name: "繼續點餐", exact: true }).click();
  await expect(dialog.getByTestId("staff-cart-line")).toHaveCount(1);
  const catalogToggle = dialog.getByTestId("staff-product-list-toggle");
  await catalogToggle.click();
  await expect(catalogToggle).toHaveAttribute("aria-expanded", "false");
  await expect(dialog.getByTestId("staff-product-list")).toHaveCount(0);
  await expect(dialog.getByTestId("staff-mobile-cart-summary")).toBeVisible();
  await catalogToggle.click();
  await expect(catalogToggle).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByTitle(`減少 ${selectedProductName}`)).toBeDisabled();
  await dialog.getByTestId("staff-mobile-cart-summary").click();
  const cartPanel = dialog.getByTestId("staff-order-cart-panel");
  await expect(cartPanel).toBeVisible();
  await cartPanel.getByTestId("staff-tablet-confirm-order").click();
  await expect(cartPanel.getByTestId("staff-order-checkout-controls")).toBeVisible();
  for (const touchTarget of [
    cartPanel.getByRole("button", { name: "立即結帳", exact: true }),
    cartPanel.getByRole("button", { name: "稍後結帳", exact: true }),
    cartPanel.getByLabel("客戶實收金額", { exact: true }),
  ]) {
    await expect.poll(async () => (await touchTarget.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const orderResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/orders")
    && response.request().method() === "POST"
  ));
  await dialog.getByRole("button", { name: "建立訂單並收款" }).click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  expect(orderResponse.request().postDataJSON()).toMatchObject({
    fulfillmentType: "TAKEOUT",
    requestedFulfillmentAt: targetPickupSlot.iso,
  });
  const payload = await orderResponse.json();
  createdOrderIds.push(payload.order.id);
  await expect.poll(() => page.evaluate(() => {
    const entry = Object.entries(window.localStorage).find(([key]) => key.startsWith("stallorder_staff_order_drafts:"));
    return entry ? (JSON.parse(entry[1]) as unknown[]).length : 0;
  })).toBe(0);
  expect(payload.order).toMatchObject({
    source: "STAFF_POS",
    status: "CONFIRMED",
    paymentStatus: "PAID",
    fulfillmentType: "TAKEOUT",
    pickupCodeLength: 3,
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/已建立、完成收款並送入廚房/)).toBeVisible();

  const stored = await prisma.order.findUniqueOrThrow({
    where: { id: payload.order.id },
    include: { payment: true, printJobs: true },
  });
  expect(stored.pickupCodeHash).toBeNull();
  expect(stored.requestedFulfillmentAt).toEqual(new Date(targetPickupSlot.iso));
  expect(stored.payment?.status).toBe("PAID");
  expect(stored.payment?.cashShiftId).toBe(cashShiftId);
  expect(stored.printJobs[0]?.status).toBe("PENDING");
  await page.screenshot({ path: testInfo.outputPath("staff-pos-mobile.png"), fullPage: true });
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);

  await page.reload();
  await expect(staffMain).toHaveCount(1);
  const futureOrdersToggle = staffMain.locator('button[aria-controls="future-scheduled-orders"]:visible');
  await expect(futureOrdersToggle).toHaveCount(1);
  await expect(futureOrdersToggle).toContainText("未來預約訂單（1）");
  await expect(futureOrdersToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("article").filter({ hasText: `訂單 ${payload.order.orderNo}` })).toHaveCount(0);
  await futureOrdersToggle.click();
  const futureOrders = staffMain.locator("#future-scheduled-orders:visible");
  await expect(futureOrders).toHaveCount(1);
  const futureTicket = futureOrders.locator("article").filter({ hasText: `訂單 ${payload.order.orderNo}` });
  await expect(futureTicket).toBeVisible();
  await expect(futureTicket).toContainText("未到製作日");
  await expect(futureTicket).toContainText("此區不提供開始製作操作");
  await expect(futureTicket.getByRole("button", { name: /開始製作|全部開始製作|完成訂單/ })).toHaveCount(0);

  const prematureProduction = await page.evaluate(async (orderId) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("stallorder_csrf="))
      ?.split("=").slice(1).join("=");
    const response = await fetch(`/api/stalls/aming-chicken/orders/${orderId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": decodeURIComponent(csrf ?? ""),
      },
      body: JSON.stringify({ status: "PREPARING" }),
    });
    return { status: response.status, payload: await response.json() };
  }, payload.order.id);
  expect(prematureProduction).toMatchObject({
    status: 409,
    payload: { code: "PRODUCTION_NOT_DUE" },
  });
  await expect.poll(async () => (await prisma.order.findUniqueOrThrow({
    where: { id: payload.order.id },
    select: { status: true },
  })).status).toBe("CONFIRMED");
});

test("店員可將同商品不同註記分列加入購物車，並移除選錯的獨立列", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await login(page);
  await page.goto("/staff/aming-chicken");
  await dismissStaffStartReminder(page);
  await page.getByRole("button", { name: "店員點餐" }).click();

  const dialog = page.getByRole("dialog", { name: "店員點餐" });
  const product = dialog.getByTestId("staff-product-card").filter({ hasText: "香酥雞排" });
  const increase = product.getByTitle("增加 香酥雞排");

  await increase.click();
  await product.getByRole("checkbox", { name: /加蛋/ }).check();
  await product.getByRole("button", { name: "加入購物車", exact: true }).click();
  await expect(product.getByText("購物車已有 1 份", { exact: true })).toBeVisible();

  await increase.click();
  await product.getByRole("checkbox", { name: /加蛋/ }).check();
  await product.getByRole("button", { name: "加入購物車", exact: true }).click();

  await increase.click();
  await product.getByRole("checkbox", { name: /加起司/ }).check();
  await product.getByRole("button", { name: "加入購物車", exact: true }).click();

  const cartLines = dialog.getByTestId("staff-cart-line");
  await expect(cartLines).toHaveCount(2);
  const eggLine = cartLines.filter({ hasText: "加蛋" });
  const cheeseLine = cartLines.filter({ hasText: "加起司" });
  await expect(eggLine).toContainText("2 × 香酥雞排");
  await expect(cheeseLine).toContainText("1 × 香酥雞排");
  const removeCheese = cheeseLine.getByRole("button", { name: "移除 香酥雞排（加起司）" });
  await expect.poll(async () => (await removeCheese.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await removeCheese.click();
  await expect(cartLines).toHaveCount(1);
  await expect(eggLine).toContainText("2 × 香酥雞排");

  await increase.click();
  await product.getByRole("checkbox", { name: /加起司/ }).check();
  await product.getByRole("button", { name: "加入購物車", exact: true }).click();
  await expect(cartLines).toHaveCount(2);
  const editableCheeseLine = cartLines.filter({ hasText: "加起司" });
  const editableLineId = await editableCheeseLine.getAttribute("data-cart-line-id");
  expect(editableLineId).not.toBeNull();
  const friedGroupToggle = dialog.getByRole("button", { name: "收合商品群組 人氣炸物", exact: true });
  await friedGroupToggle.click();
  await expect(dialog.getByRole("button", { name: "展開商品群組 人氣炸物", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(product).toHaveCount(0);
  await editableCheeseLine.getByRole("button", { name: "修改客製", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "收合商品群組 人氣炸物", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(product).toBeVisible();
  await expect(product.getByRole("checkbox", { name: /加起司/ })).toBeChecked();
  await editableCheeseLine.getByRole("button", { name: "增加 香酥雞排（加起司）", exact: true }).click();
  await expect(editableCheeseLine).toContainText("2 × 香酥雞排");
  await product.getByRole("checkbox", { name: /加蛋/ }).check();
  await expect(product.getByRole("button", { name: "修改完成", exact: true })).toBeVisible();
  await product.getByRole("button", { name: "修改完成", exact: true }).click();
  await expect(cartLines).toHaveCount(2);
  const editedLine = dialog.locator(`[data-testid="staff-cart-line"][data-cart-line-id="${editableLineId!}"]`);
  await expect(editedLine).toContainText("2 × 香酥雞排");
  await expect(editedLine).toContainText("加蛋、加起司");
  await editedLine.getByRole("button", { name: "修改客製", exact: true }).click();
  await editedLine.getByRole("button", { name: /減少 香酥雞排/ }).click();
  await expect(editedLine).toContainText("1 × 香酥雞排");
  await product.getByRole("button", { name: "修改完成", exact: true }).click();
  await expect(editedLine).toContainText("1 × 香酥雞排");
  await dialog.getByRole("button", { name: "稍後結帳", exact: true }).click();

  const orderResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/stalls/aming-chicken/orders")
    && response.request().method() === "POST"
  ));
  await dialog.getByRole("button", { name: "建立訂單送入廚房", exact: true }).click();
  const orderResponse = await orderResponsePromise;
  expect(orderResponse.status()).toBe(201);
  const requestItems = orderResponse.request().postDataJSON().items as Array<{
    productId: string;
    quantity: number;
    noteOptionIds: string[];
  }>;
  expect(requestItems).toHaveLength(2);
  expect(new Set(requestItems.map((item) => item.productId)).size).toBe(1);
  expect(requestItems.map((item) => item.quantity).sort()).toEqual([1, 2]);
  expect(requestItems.map((item) => item.noteOptionIds.length).sort()).toEqual([1, 2]);
  expect(requestItems[0]?.noteOptionIds).not.toEqual(requestItems[1]?.noteOptionIds);

  const payload = await orderResponse.json();
  createdOrderIds.push(payload.order.id);
  const stored = await prisma.order.findUniqueOrThrow({
    where: { id: payload.order.id },
    include: { items: { include: { noteOptions: true } } },
  });
  expect(stored.items).toHaveLength(2);
  expect(stored.items.map((item) => item.quantity).sort()).toEqual([1, 2]);
  expect(stored.items.flatMap((item) => item.noteOptions.map((option) => option.optionName)).sort())
    .toEqual(["加蛋", "加蛋", "加起司"]);
});

test("LINE 固定外送網址可指定送達時間，店家提議後由顧客確認", async ({ browser, page }, testInfo) => {
  test.setTimeout(120_000);
  const settingsContext = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei" });
  try {
    const settingsPage = await settingsContext.newPage();
    await login(settingsPage);
    await settingsPage.goto(`/merchant/stalls/${stallId}/settings/delivery`);
    await expect(settingsPage.getByRole("heading", { name: "線上外送", exact: true })).toBeVisible();
    await expect(settingsPage.getByRole("switch", { name: /線上外送/u })).toHaveAttribute("aria-checked", "true");
  } finally {
    await settingsContext.close();
  }

  await prisma.publicRateLimitBucket.deleteMany({ where: { stallId } });
  await page.setExtraHTTPHeaders({ "x-vercel-forwarded-for": "203.0.113.101" });
  await page.setViewportSize({ width: 390, height: 844 });
  const customerName = `LINE 外送 QA ${Date.now()}`;
  const deliveryAddress = "台北市信義區測試路 1 號 2 樓";
  const sessionResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/create-order-session")
    && response.request().method() === "POST"
  ));
  await page.goto("/delivery/aming-chicken");
  const sessionResponse = await sessionResponsePromise;
  expect([200, 201]).toContain(sessionResponse.status());
  const session = await sessionResponse.json() as {
    requiresWaitAcknowledgment: boolean;
  };
  expect(session).toMatchObject({
    requiresWaitAcknowledgment: expect.any(Boolean),
  });
  const slotRows = await prisma.$queryRaw<Array<{ slots: unknown }>>`
    select public.get_takeout_preorder_slots(${stallId}::uuid, now()) as slots
  `;
  const fulfillmentSlots = buildFulfillmentTimeSlots(
    Array.isArray(slotRows[0]?.slots)
      ? slotRows[0].slots.filter((slot): slot is string => typeof slot === "string")
      : [],
    "Asia/Taipei",
  );
  const requestedSlot = fulfillmentSlots[0];
  const proposedSlot = fulfillmentSlots[1];
  if (!requestedSlot || !proposedSlot) {
    throw new Error("外送指定時間 E2E 至少需要兩個 5 分鐘單位的可用時段。");
  }
  const requestedFulfillmentAt = requestedSlot.iso;
  const proposedFulfillmentAt = proposedSlot.iso;
  await expect(page.getByRole("main").getByText("外送", { exact: true })).toBeVisible();
  await expect(page.getByTestId("qr-cart-panel")).toBeHidden();
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("line-delivery-mobile.png"), fullPage: true });

  const deliveryProduct = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "香酥雞排", exact: true }),
  });
  await deliveryProduct.getByRole("button", { name: "增加 香酥雞排", exact: true }).click();
  const requiredGroups = page.locator("fieldset").filter({ has: page.locator("legend") });
  for (let index = 0; index < await requiredGroups.count(); index += 1) {
    const group = requiredGroups.nth(index);
    if ((await group.locator("legend").innerText()).includes("*")) {
      await group.locator('input[type="radio"], input[type="checkbox"]').first().check();
    }
  }
  await deliveryProduct.getByRole("button", { name: "加入購物車", exact: true }).click();
  await page.getByTestId("qr-mobile-cart-summary").click();
  const deliveryCartPanel = page.getByTestId("qr-cart-panel");
  await expect(deliveryCartPanel).toHaveAttribute("role", "dialog");
  await deliveryCartPanel.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
  await expect(deliveryCartPanel.getByLabel("聯絡電話")).toBeVisible();
  await expect(deliveryCartPanel.getByLabel("外送地址")).toBeVisible();
  await expect(page.getByRole("radio", { name: "儘快，不指定時間" })).toBeChecked();
  await page.getByRole("radio", { name: "指定送達時間" }).check();
  const deliveryFields = page.getByTestId("qr-delivery-fulfillment-time-fields");
  const deliveryDate = deliveryFields.getByLabel("送達日期");
  const deliveryHour = deliveryFields.getByLabel("送達時間－時");
  const deliveryMinute = deliveryFields.getByLabel("送達時間－分");
  await expect(deliveryDate).toHaveAttribute("type", "date");
  await expect(deliveryDate).toHaveAttribute("min", fulfillmentSlots[0]!.date);
  await expect(deliveryDate).toHaveAttribute("max", fulfillmentSlots.at(-1)!.date);
  for (const control of [deliveryDate, deliveryHour, deliveryMinute]) {
    expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await deliveryDate.fill(requestedSlot.date);
  await deliveryHour.selectOption(requestedSlot.hour);
  await deliveryMinute.selectOption(requestedSlot.minute);
  await expect(deliveryHour).toHaveValue(requestedSlot.hour);
  await expect(deliveryMinute).toHaveValue(requestedSlot.minute);
  expect((await deliveryHour.locator("option").allTextContents()).every((hour) => (
    /^(?:[01]\d|2[0-3])$/.test(hour)
  ))).toBe(true);
  expect((await deliveryMinute.locator("option").allTextContents()).every((minute) => (
    /^(?:[0-5]\d)$/.test(minute) && Number(minute) % 5 === 0
  ))).toBe(true);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.getByLabel("顧客稱呼").fill(customerName);
  await page.getByLabel("聯絡電話").fill("0912345678");
  await page.getByLabel("外送地址").fill(deliveryAddress);

  await expect.poll(() => page.evaluate(() => {
    const raw = Object.entries(window.localStorage)
      .find(([key]) => key.startsWith("stallorder_qr_cart:") && key.endsWith(":delivery"))?.[1];
    if (!raw) return null;
    const draft = JSON.parse(raw) as {
      orderingMode?: string;
      scheduledPickupAt?: string;
      customerPhone?: string;
      deliveryAddress?: string;
    };
    return {
      orderingMode: draft.orderingMode,
      scheduledPickupAt: draft.scheduledPickupAt,
      customerPhone: draft.customerPhone,
      deliveryAddress: draft.deliveryAddress,
    };
  })).toEqual({
    orderingMode: "DELIVERY",
    scheduledPickupAt: requestedFulfillmentAt,
    customerPhone: "0912345678",
    deliveryAddress,
  });

  await page.reload();
  await page.getByTestId("qr-mobile-cart-summary").click();
  const restoredDeliveryCartPanel = page.getByRole("dialog", { name: "您的訂單" });
  await expect(restoredDeliveryCartPanel).toBeVisible();
  await restoredDeliveryCartPanel.getByRole("button", { name: "繼續填寫訂購資料", exact: true }).click();
  await expect(restoredDeliveryCartPanel.getByRole("radio", { name: "指定送達時間" })).toBeChecked();
  const restoredDeliveryFields = restoredDeliveryCartPanel.getByTestId("qr-delivery-fulfillment-time-fields");
  await expect(restoredDeliveryFields.getByLabel("送達日期")).toHaveValue(requestedSlot.date);
  await expect(restoredDeliveryFields.getByLabel("送達時間－時")).toHaveValue(requestedSlot.hour);
  await expect(restoredDeliveryFields.getByLabel("送達時間－分")).toHaveValue(requestedSlot.minute);
  await expect(restoredDeliveryCartPanel.getByLabel("顧客稱呼")).toHaveValue(customerName);
  await expect(restoredDeliveryCartPanel.getByLabel("聯絡電話")).toHaveValue("0912345678");
  await expect(restoredDeliveryCartPanel.getByLabel("外送地址")).toHaveValue(deliveryAddress);
  const submit = restoredDeliveryCartPanel.getByRole("button", { name: "送出訂單", exact: true });
  const waitAcknowledgment = restoredDeliveryCartPanel.getByRole("checkbox", {
    name: /我已了解目前預估等候時間為/,
  });
  if (session.requiresWaitAcknowledgment) {
    await expect(waitAcknowledgment).toBeVisible();
    await expect(submit).toBeDisabled();
    await waitAcknowledgment.check();
  } else {
    await expect(waitAcknowledgment).toHaveCount(0);
  }
  await expect(page.getByLabel("安全驗證")).toBeVisible();
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  const createResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/create-public-order")
    && response.request().method() === "POST"
  ));
  await submit.click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  await expect(page).toHaveURL(/\/order\//);
  await expect(page.getByText(deliveryAddress, { exact: true })).toBeVisible();
  await expect(page.getByText("取餐驗證碼", { exact: true })).toHaveCount(0);

  const order = await prisma.order.findFirstOrThrow({
    where: { stallId, source: "LINE_DELIVERY", customerName },
    select: {
      id: true,
      fulfillmentType: true,
      status: true,
      pickupCodeHash: true,
      deliveryAddress: true,
      customerPhone: true,
      requestedFulfillmentAt: true,
      committedFulfillmentAt: true,
      fulfillmentTimeState: true,
      fulfillmentTimeVersion: true,
    },
  });
  createdOrderIds.push(order.id);
  expect(order).toMatchObject({
    fulfillmentType: "DELIVERY",
    status: "WAITING_CONFIRMATION",
    pickupCodeHash: null,
    deliveryAddress,
    customerPhone: "0912345678",
    requestedFulfillmentAt: new Date(requestedFulfillmentAt),
    committedFulfillmentAt: null,
    fulfillmentTimeState: "REQUESTED",
    fulfillmentTimeVersion: 1,
  });

  const staffContext = await browser.newContext({
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    viewport: { width: 1024, height: 900 },
  });
  try {
    const staffPage = await staffContext.newPage();
    await login(staffPage);
    await staffPage.goto("/staff/aming-chicken");
    await dismissStaffStartReminder(staffPage);
    const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
    await staffOrder.getByRole("button", { name: "查看明細", exact: true }).click();
    await expect(staffOrder).toContainText("顧客希望送達");
    await staffOrder.getByRole("button", { name: "提出新時間", exact: true }).click();

    const proposalDialog = staffPage.getByRole("dialog", { name: "提出新的送達時間" });
    const proposalFields = proposalDialog.getByTestId("staff-time-proposal-fields");
    const proposalDate = proposalFields.getByLabel("送達日期");
    const proposalHour = proposalFields.getByLabel("送達時間－時");
    const proposalMinute = proposalFields.getByLabel("送達時間－分");
    await expect(proposalDate).toHaveAttribute("type", "date");
    await expect(proposalDate).toHaveAttribute("min", fulfillmentSlots[0]!.date);
    await expect(proposalDate).toHaveAttribute("max", fulfillmentSlots.at(-1)!.date);
    for (const control of [proposalDate, proposalHour, proposalMinute]) {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await proposalDate.fill(proposedSlot.date);
    await proposalHour.selectOption(proposedSlot.hour);
    await proposalMinute.selectOption(proposedSlot.minute);
    await expect(proposalHour).toHaveValue(proposedSlot.hour);
    await expect(proposalMinute).toHaveValue(proposedSlot.minute);
    expect((await proposalHour.locator("option").allTextContents()).every((hour) => (
      /^(?:[01]\d|2[0-3])$/.test(hour)
    ))).toBe(true);
    expect((await proposalMinute.locator("option").allTextContents()).every((minute) => (
      /^(?:[0-5]\d)$/.test(minute) && Number(minute) % 5 === 0
    ))).toBe(true);
    await proposalDialog.getByLabel("調整原因").fill("目前訂單較多，建議延後送達");
    const proposalResponsePromise = staffPage.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith(`/orders/${order.id}/fulfillment-time`)
      && response.request().method() === "PATCH"
    ));
    await proposalDialog.getByRole("button", { name: "通知顧客確認", exact: true }).click();
    const proposalResponse = await proposalResponsePromise;
    expect(proposalResponse.status()).toBe(200);
    expect(proposalResponse.request().postDataJSON()).toMatchObject({
      operation: "PROPOSE",
      proposedFulfillmentAt,
    });
    await expect(staffOrder).toContainText("等待顧客確認新送達時間");
    await expect(staffOrder.getByRole("button", { name: /全部開始製作/ })).toHaveCount(0);

    await page.getByRole("button", { name: "重新整理訂單" }).click();
    const customerTimePanel = page.getByRole("region", { name: "預計送達時間" });
    await expect(customerTimePanel.getByText("等待您確認新時間", { exact: true })).toBeVisible();
    await expect(customerTimePanel).toContainText("目前訂單較多，建議延後送達");
    const customerResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/fulfillment-time")
      && response.request().method() === "POST"
    ));
    await customerTimePanel.getByRole("button", { name: "接受新送達時間", exact: true }).click();
    expect((await customerResponsePromise).status()).toBe(200);
    await expect(customerTimePanel.getByRole("status")).toContainText("已接受店家提議的新時間");

    await expect.poll(async () => prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        fulfillmentTimeState: true,
        fulfillmentTimeVersion: true,
        committedFulfillmentAt: true,
        pendingFulfillmentAt: true,
      },
    })).toEqual({
      fulfillmentTimeState: "CONFIRMED",
      fulfillmentTimeVersion: 2,
      committedFulfillmentAt: new Date(proposedFulfillmentAt),
      pendingFulfillmentAt: null,
    });
    await expect.poll(async () => prisma.orderEvent.count({
      where: {
        orderId: order.id,
        eventType: { in: ["FULFILLMENT_TIME_PROPOSED", "FULFILLMENT_TIME_ACCEPTED"] },
      },
    })).toBe(2);

    await staffPage.getByRole("button", { name: "重新整理", exact: true }).click();
    await expect(staffOrder).toContainText("已確認送達");
  } finally {
    await staffContext.close();
  }
});

test("外送頁依瀏覽器語系顯示英文欄位", async ({ browser }) => {
  await prisma.publicRateLimitBucket.deleteMany({ where: { stallId } });
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "x-vercel-forwarded-for": "203.0.113.102" },
  });
  try {
    const page = await context.newPage();
    const appUrl = process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001";
    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto(`${appUrl}/delivery/aming-chicken`);
    expect([200, 201]).toContain((await sessionResponsePromise).status());
    const deliveryProduct = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Deep-Fried Chicken Cutlet", exact: true }),
    });
    await deliveryProduct.getByRole("button", { name: "Increase Deep-Fried Chicken Cutlet", exact: true }).click();
    await deliveryProduct.getByRole("button", { name: "Add to cart", exact: true }).click();
    await page.getByTestId("qr-mobile-cart-summary").click();
    const deliveryCartPanel = page.getByTestId("qr-cart-panel");
    await expect(deliveryCartPanel).toHaveAttribute("role", "dialog");
    await deliveryCartPanel.getByRole("button", { name: "Continue to checkout", exact: true }).click();
    await expect(deliveryCartPanel.getByLabel("Contact phone")).toBeVisible({ timeout: 30_000 });
    await expect(deliveryCartPanel.getByLabel("Delivery address")).toBeVisible();
    await expect(deliveryCartPanel.getByRole("heading", { name: "Details and confirmation", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
