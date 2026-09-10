import { expect, test, type Route } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildFulfillmentTimeSlots } from "../src/lib/fulfillment-time-options";
import { continueQrCheckout as continueCheckout, qrProductSelectionControl } from "./local-navigation";

const qrToken = `e2e-qr-edit-${Date.now()}`;
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const prisma = new PrismaClient();
let originalHours: Array<{
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}> = [];
let createdOrderId = "";
let createdPickupOrderId = "";
let fixtureQrId = "";
let originalLotteryEnabled = false;

test.use({
  serviceWorkers: "block",
  userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/149 Mobile Safari/537.36 Line/14.0.0",
});

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const hostname = databaseUrl ? new URL(databaseUrl).hostname : "";
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("QR_EDIT_E2E_REQUIRES_LOCAL_DATABASE");
  }
  originalLotteryEnabled = (await prisma.stallOrderingSettings.findUniqueOrThrow({ where: { stallId } })).lotteryEnabled;
  // This amendment case covers an ordinary paid cart; lottery gifts have separate lifecycle cases.
  await prisma.stallOrderingSettings.update({ where: { stallId }, data: { lotteryEnabled: false } });
  originalHours = await prisma.stallBusinessHour.findMany({
    where: { stallId },
    select: { id: true, opensAt: true, closesAt: true, isClosed: true },
  });
  await prisma.stallBusinessHour.updateMany({
    where: { stallId },
    data: { opensAt: "00:00", closesAt: "00:00", isClosed: false },
  });
  const qrVersion = await prisma.qrCode.aggregate({
    where: { stallId },
    _max: { tokenVersion: true },
  });
  fixtureQrId = (await prisma.qrCode.create({
    data: {
      organizationId,
      stallId,
      token: qrToken,
      label: "QR edit local E2E",
      state: "ACTIVE",
      tokenVersion: (qrVersion._max.tokenVersion ?? 0) + 1,
    },
    select: { id: true },
  })).id;
});

test.afterAll(async () => {
  try {
    await prisma.stallOrderingSettings.update({ where: { stallId }, data: { lotteryEnabled: originalLotteryEnabled } });
    for (const orderId of [createdOrderId, createdPickupOrderId].filter(Boolean)) {
      const orderSession = await prisma.orderSession.findFirst({
        where: { orderId },
        select: { id: true },
      });
      await prisma.order.deleteMany({ where: { id: orderId } });
      if (orderSession) {
        await prisma.publicOrderAttempt.deleteMany({
          where: { orderSessionId: orderSession.id },
        });
        await prisma.orderSession.deleteMany({ where: { id: orderSession.id } });
      }
    }
    if (fixtureQrId) {
      await prisma.publicOrderAttempt.deleteMany({ where: { qrCodeId: fixtureQrId } });
      await prisma.qrCode.deleteMany({ where: { id: fixtureQrId } });
    }
    await Promise.all(originalHours.map((hour) => prisma.stallBusinessHour.update({
      where: { id: hour.id },
      data: {
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        isClosed: hour.isClosed,
      },
    })));
  } finally {
    await prisma.$disconnect();
  }
});

test("本機 QR 外帶可修改原訂單並由顧客取消", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const sessionResponse = page.waitForResponse(
    (response) =>
      ["/create-order-session", "/api/public/order-session"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  await page.goto(`/q/${qrToken}`);
  expect((await sessionResponse).status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }),
  ).toBeVisible();

  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await qrProductSelectionControl(product, "香酥雞排").click();
  await product
    .getByRole("button", { name: "加入購物車", exact: true })
    .click();
  await page.getByTestId("qr-mobile-cart-summary").click();
  const cart = page.getByTestId("qr-cart-panel");
  await cart
    .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
    .click();
  await continueCheckout(page);
  await expect(page.getByLabel("顧客稱呼")).toHaveCount(0);
  await expect(page.getByLabel("聯絡電話")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "訂單備註", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "訂單備註", exact: true }).fill(`QR edit E2E ${Date.now()}`);
  const noteBeforeEdit = await page.getByRole("textbox", { name: "訂單備註", exact: true }).inputValue();
  const utensils = page.getByRole("checkbox", { name: "需要免洗餐具", exact: true });
  await expect(utensils).not.toBeChecked();
  await utensils.check();
  let maintenance = true;
  await page.route("**/api/availability/config", async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, qrOrdering: maintenance ? "MAINTENANCE" : config.qrOrdering } });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("alertdialog", { name: "點餐系統更新中" })).toBeVisible();
  await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeDisabled();
  maintenance = false;
  await page.getByRole("alertdialog", { name: "點餐系統更新中" }).getByRole("button", { name: "重新檢查", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "點餐系統更新中" })).toBeHidden();
  await expect(utensils).toBeChecked();
  await expect(page.getByRole("textbox", { name: "訂單備註", exact: true })).toHaveValue(noteBeforeEdit);
  await page.unroute("**/api/availability/config");
  const waitAcknowledgment = page.getByRole("checkbox", {
    name: /我已了解目前預估等候時間/u,
  });
  if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

  let createResponsePromise = page.waitForResponse(
    (response) =>
      ["/create-public-order", "/api/public/orders"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  const trackerResponsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return (
      (pathname.includes("/api/public/orders/sto_") && response.request().method() === "GET")
      || (pathname.endsWith("/get-public-order") && response.request().method() === "POST")
    );
  });
  const submit = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await page.screenshot({ path: test.info().outputPath("utensils-checkout.png") });
  await submit.click();
  let createResponse = await createResponsePromise;
  if (createResponse.status() === 422) {
    await expect(createResponse.json()).resolves.toMatchObject({
      code: "WAIT_ACKNOWLEDGMENT_REQUIRED",
    });
    await expect(waitAcknowledgment).toBeVisible();
    await waitAcknowledgment.check();
    createResponsePromise = page.waitForResponse(
      (response) =>
        ["/create-public-order", "/api/public/orders"].some((path) =>
          new URL(response.url()).pathname.endsWith(path),
        ) && response.request().method() === "POST",
    );
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await submit.click();
    createResponse = await createResponsePromise;
  }
  expect([200, 201]).toContain(createResponse.status());
  const createRequest = createResponse.request().postDataJSON() as {
    clientOrderId?: string;
  };
  createdOrderId = createRequest.clientOrderId ?? "";
  expect(createdOrderId).toMatch(/^[0-9a-f-]{36}$/iu);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: createdOrderId } })).note).toBe("【免洗餐具：需要】\n" + noteBeforeEdit);
  await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+(?:\?.*)?$/u);
  const trackerUrl = new URL(page.url());
  expect(trackerUrl.searchParams.get("qr")).toBe(qrToken);
  const trackingToken = trackerUrl.pathname.split("/").at(-1);
  expect(trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/u);
  expect((await trackerResponsePromise).status()).toBe(200);
  const trackerHeader = page.getByTestId("public-order-tracker-header");
  const trackerStallName = page.getByTestId("public-order-tracker-stall-name");
  const trackerActions = page.getByTestId("public-order-tracker-actions");
  await expect(trackerHeader).toBeVisible();
  await expect(trackerActions).toBeVisible();
  const stallNameBox = await trackerStallName.boundingBox();
  expect(stallNameBox).not.toBeNull();
  expect(stallNameBox!.width).toBeGreaterThan(stallNameBox!.height * 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole("link", { name: "修改訂單", exact: true })).toBeVisible();

  const reorderPageResponse = await page.request.get(
    `/order/${trackingToken}/reorder`,
  );
  expect(reorderPageResponse.status()).toBe(200);

  let prepareAttempts = 0;
  const interceptFirstPrepareAttempt = async (route: Route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    prepareAttempts += 1;
    if (prepareAttempts === 1) {
      await route.abort("timedout");
      return;
    }
    await route.continue();
  };
  await page.route("**/functions/v1/prepare-reorder", interceptFirstPrepareAttempt);
  await page.route(
    "**/api/public-order/prepare-reorder",
    interceptFirstPrepareAttempt,
  );
  await page.route(
    `**/api/public/orders/${trackingToken}/reorder`,
    interceptFirstPrepareAttempt,
  );
  await page.getByRole("link", { name: "修改訂單", exact: true }).click();
  await expect(page.getByText("目前無法準備訂單修改。", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const retryPrepare = page.getByRole("button", { name: "再試一次", exact: true });
  await expect(retryPrepare).toBeVisible();

  const prepareResponsePromise = page.waitForResponse(
    (response) =>
      [
        "/functions/v1/prepare-reorder",
        "/api/public-order/prepare-reorder",
        `/api/public/orders/${trackingToken}/reorder`,
      ].some((path) => new URL(response.url()).pathname.endsWith(path)) &&
      response.request().method() === "POST",
  );
  await retryPrepare.click();
  const prepareResponse = await prepareResponsePromise;
  expect(prepareResponse.status()).toBe(200);
  const preparePath = new URL(prepareResponse.url()).pathname;
  if (preparePath.endsWith(`/api/public/orders/${trackingToken}/reorder`)) {
    expect(prepareResponse.headers()["x-order-circuit"]).toBe("B");
  } else {
    expect([
      "/functions/v1/prepare-reorder",
      "/api/public-order/prepare-reorder",
    ]).toContain(preparePath);
  }
  await expect(
    page.getByRole("heading", { name: "修改訂單", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("香酥雞排", { exact: false })).toBeVisible();
  await expect(page.getByText("Failed to fetch", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page
    .getByRole("button", { name: "前往目前菜單修改", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/q/${qrToken}\\?`, "u"));
  const editUrl = new URL(page.url());
  expect(editUrl.searchParams.get("editOrder")).toMatch(
    /^sto_[A-Za-z0-9_-]+$/u,
  );
  await expect(
    page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }),
  ).toBeVisible();

  await page.getByTestId("qr-mobile-cart-summary").click();
  const editCart = page.getByTestId("qr-cart-panel");
  await expect(editCart.getByTestId("qr-cart-line")).toHaveCount(1);
  await editCart.getByRole("button", { name: /增加 香酥雞排/u }).click();
  await editCart
    .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
    .click();
  await continueCheckout(page);
  await expect(page.getByRole("checkbox", { name: "需要免洗餐具", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "訂單備註", exact: true })).toHaveValue(noteBeforeEdit);
  await page.getByRole("checkbox", { name: "需要免洗餐具", exact: true }).uncheck();
  const editResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/api/public/orders/${trackingToken}`) &&
      response.request().method() === "PATCH",
  );
  const saveChanges = page.getByRole("button", {
    name: "儲存訂單修改",
    exact: true,
  });
  await expect(saveChanges).toBeEnabled({ timeout: 20_000 });
  await saveChanges.click();
  expect((await editResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+(?:\?.*)?$/u);

  const editedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: createdOrderId },
    select: { note: true, items: { select: { name: true, quantity: true } } },
  });
  expect(editedOrder.note).toBe(noteBeforeEdit);
  expect(editedOrder.items).toEqual([
    expect.objectContaining({ name: "香酥雞排", quantity: 2 }),
  ]);

  await expect(page).toHaveURL(trackerUrl.toString());
  await expect(page.getByRole("button", { name: "取消訂單", exact: true })).toBeVisible();
  let cancellationStarted = false;
  await page.route(`**/api/public/orders/${trackingToken}`, async (route) => {
    if (route.request().method() === "DELETE") {
      cancellationStarted = true;
      await route.continue();
      return;
    }
    if (route.request().method() === "GET" && cancellationStarted) {
      await new Promise((resolve) => setTimeout(resolve, 4_500));
    }
    await route.continue().catch(() => undefined);
  });
  const cancelResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/api/public/orders/${trackingToken}`) &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "取消訂單", exact: true }).click();
  const cancelDialog = page.getByRole("alertdialog", { name: "取消訂單" });
  await expect(cancelDialog).toContainText("確定要取消此訂單嗎？取消後無法復原。");
  await cancelDialog.getByRole("button", { name: "取消訂單", exact: true }).click();
  expect((await cancelResponsePromise).status()).toBe(200);
  await expect(page.getByText("已取消", { exact: true })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText(/signal timed out/iu)).toHaveCount(0);
});

test("本機外帶自取修改訂單會保留顧客姓名與手機", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const sessionResponse = page.waitForResponse(
    (response) =>
      ["/create-order-session", "/api/public/order-session"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  await page.goto("/store/aming-01?view=pickup");
  const sessionResult = await sessionResponse;
  expect(sessionResult.status()).toBe(201);
  const session = await sessionResult.json() as {
    preorderSlots: string[];
    stall: { timezone: string };
  };
  await expect(
    page.getByRole("heading", { name: "阿明鹽酥雞", exact: true }),
  ).toBeVisible();

  const pickupSlot = buildFulfillmentTimeSlots(
    session.preorderSlots,
    session.stall.timezone,
  )[Math.min(6, session.preorderSlots.length - 1)];
  expect(pickupSlot).toBeDefined();
  const pickupFields = page.getByTestId("qr-preorder-fulfillment-time-fields");
  await pickupFields.getByLabel("預約取餐日期").fill(pickupSlot!.date);
  await pickupFields.getByLabel("預約取餐時間－時").selectOption(pickupSlot!.hour);
  await pickupFields.getByLabel("預約取餐時間－分").selectOption(pickupSlot!.minute);
  const applyPickupTime = page.getByRole("button", {
    name: "套用這個時間",
    exact: true,
  });
  await applyPickupTime.click();

  const product = page.getByRole("article").filter({ hasText: "香酥雞排" });
  await qrProductSelectionControl(product, "香酥雞排").click();
  await product.getByRole("button", { name: "加入購物車", exact: true }).click();
  await page.getByTestId("qr-mobile-cart-summary").click();
  await page
    .getByTestId("qr-cart-panel")
    .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
    .click();
  await continueCheckout(page);

  const customerName = "外帶修改測試";
  const customerPhone = "0912345678";
  await page.getByLabel("顧客稱呼").fill(customerName);
  await page.getByLabel("聯絡電話").fill(customerPhone);

  const createResponsePromise = page.waitForResponse(
    (response) =>
      ["/create-public-order", "/api/public/orders"].some((path) =>
        new URL(response.url()).pathname.endsWith(path),
      ) && response.request().method() === "POST",
  );
  const submit = page.getByRole("button", { name: "送出訂單", exact: true });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  const createResponse = await createResponsePromise;
  expect([200, 201]).toContain(createResponse.status());
  const createRequest = createResponse.request().postDataJSON() as {
    clientOrderId?: string;
  };
  createdPickupOrderId = createRequest.clientOrderId ?? "";
  expect(createdPickupOrderId).toMatch(/^[0-9a-f-]{36}$/iu);

  await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+(?:\?.*)?$/u);
  const trackerUrl = new URL(page.url());
  const trackingToken = new URL(page.url()).pathname.split("/").at(-1);
  expect(trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/u);
  await page.getByRole("link", { name: "修改訂單", exact: true }).click();
  await expect(page.getByRole("heading", { name: "修改訂單", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "前往目前菜單修改", exact: true })
    .click();

  await expect(page).toHaveURL(/\/store\/aming-01\?.*editOrder=sto_/u);
  await expect(page.getByTestId("qr-mobile-cart-summary")).toBeVisible();
  await page.getByTestId("qr-mobile-cart-summary").click();
  await page
    .getByTestId("qr-cart-panel")
    .getByRole("button", { name: "繼續填寫訂購資料", exact: true })
    .click();
  await continueCheckout(page);
  await expect(page.getByLabel("顧客稱呼")).toHaveValue(customerName);
  await expect(page.getByLabel("聯絡電話")).toHaveValue(customerPhone);

  const editResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/api/public/orders/${trackingToken}`) &&
      response.request().method() === "PATCH",
  );
  const saveChanges = page.getByRole("button", {
    name: "儲存訂單修改",
    exact: true,
  });
  await expect(saveChanges).toBeEnabled({ timeout: 20_000 });
  await saveChanges.click();
  expect((await editResponsePromise).status()).toBe(200);

  const editedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: createdPickupOrderId },
    select: { customerName: true, customerPhone: true },
  });
  expect(editedOrder).toMatchObject({ customerName, customerPhone });

  await expect(page).toHaveURL(trackerUrl.toString());
  await expect(page.getByRole("button", { name: "取消訂單", exact: true })).toBeVisible();
  let cancellationStarted = false;
  await page.route(`**/api/public/orders/${trackingToken}`, async (route) => {
    if (route.request().method() === "DELETE") {
      cancellationStarted = true;
      await route.continue();
      return;
    }
    if (route.request().method() === "GET" && cancellationStarted) {
      await new Promise((resolve) => setTimeout(resolve, 4_500));
    }
    await route.continue().catch(() => undefined);
  });
  const cancelResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/api/public/orders/${trackingToken}`) &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "取消訂單", exact: true }).click();
  const cancelDialog = page.getByRole("alertdialog", { name: "取消訂單" });
  await expect(cancelDialog).toContainText("確定要取消此訂單嗎？取消後無法復原。");
  await cancelDialog.getByRole("button", { name: "取消訂單", exact: true }).click();
  expect((await cancelResponsePromise).status()).toBe(200);
  await expect(page.getByText("已取消", { exact: true })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText(/signal timed out/iu)).toHaveCount(0);
});
