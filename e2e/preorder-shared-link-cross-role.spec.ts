import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildFulfillmentTimeSlots } from "../src/lib/fulfillment-time-options";

loadLocalEnv();
assertLocalDatabase();

const prisma = new PrismaClient();
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const testTimeZone = "Asia/Taipei";
const marker = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const customerName = `預約跨角色 E2E ${marker}`;
const retainedProductName = `跨時段保留餐 ${marker}`;
const prunedProductName = `首時段限定餐 ${marker}`;
const noteGroupName = `跨角色份量 ${marker}`;
const noteOptionName = `正常份量 ${marker}`;
const qrToken = `e2e-preorder-shared-${marker}`;

type SettingsSnapshot = {
  takeoutPreorderEnabled: boolean;
  preorderMinLeadMinutes: number;
  preorderMaxDays: number;
  preorderSlotMinutes: number;
  businessDayCutoffHour: number;
  lotteryEnabled: boolean;
};

type StallSnapshot = {
  businessStatus: "OPEN" | "PAUSED" | "CLOSED" | "SOLD_OUT";
  orderingEnabled: boolean;
  orderingState: "OPEN" | "PAUSED" | "CLOSED";
  isActive: boolean;
  isSoldOut: boolean;
};

type BusinessHourSnapshot = {
  id: string;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
};

let originalSettings: SettingsSnapshot | null = null;
let originalStall: StallSnapshot | null = null;
let originalHours: BusinessHourSnapshot[] = [];
let fixtureQrId = "";
let retainedProductId = "";
let prunedProductId = "";
let noteGroupId = "";
let noteOptionId = "";
let createdOrderId = "";
let createdSessionId = "";
let firstPickupSlot = "";
let secondPickupSlot = "";

test.describe("分享連結 PREORDER 同單跨角色", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const [settings, stall, hours, sourceProduct, station, qrVersion] = await Promise.all([
      prisma.stallOrderingSettings.findUniqueOrThrow({
        where: { stallId },
        select: {
          takeoutPreorderEnabled: true,
          preorderMinLeadMinutes: true,
          preorderMaxDays: true,
          preorderSlotMinutes: true,
          businessDayCutoffHour: true,
          lotteryEnabled: true,
        },
      }),
      prisma.stall.findUniqueOrThrow({
        where: { id: stallId },
        select: {
          businessStatus: true,
          orderingEnabled: true,
          orderingState: true,
          isActive: true,
          isSoldOut: true,
        },
      }),
      prisma.stallBusinessHour.findMany({
        where: { organizationId, stallId },
        orderBy: { dayOfWeek: "asc" },
        select: { id: true, opensAt: true, closesAt: true, isClosed: true },
      }),
      prisma.stallProduct.findFirstOrThrow({
        where: {
          organizationId,
          stallId,
          isEnabled: true,
          product: { isActive: true, category: { isActive: true } },
        },
        orderBy: { sortOrder: "asc" },
        select: { product: { select: { categoryId: true } } },
      }),
      prisma.kitchenStation.findFirstOrThrow({
        where: { organizationId, stallId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      }),
      prisma.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } }),
    ]);

    expect(hours).toHaveLength(7);
    expect(station.id).not.toBe("");
    originalSettings = settings;
    originalStall = stall;
    originalHours = hours;
    const businessDayCutoffHour = currentHourInTimeZone(testTimeZone);

    await prisma.$transaction([
      prisma.stallOrderingSettings.update({
        where: { stallId },
        data: {
          takeoutPreorderEnabled: true,
          preorderMinLeadMinutes: 15,
          preorderMaxDays: 1,
          preorderSlotMinutes: 30,
          businessDayCutoffHour,
          lotteryEnabled: false,
        },
      }),
      prisma.stall.update({
        where: { id: stallId },
        data: {
          businessStatus: "OPEN",
          orderingEnabled: true,
          orderingState: "OPEN",
          isActive: true,
          isSoldOut: false,
        },
      }),
      prisma.stallBusinessHour.updateMany({
        where: { organizationId, stallId },
        data: { opensAt: "00:00", closesAt: "23:59", isClosed: false },
      }),
    ]);

    const slotRows = await prisma.$queryRaw<Array<{ slots: unknown }>>`
      select public.get_takeout_preorder_slots(${stallId}::uuid, now()) as slots
    `;
    const slots = Array.isArray(slotRows[0]?.slots)
      ? slotRows[0].slots.filter((slot): slot is string => typeof slot === "string")
      : [];
    if (slots.length < 2) {
      throw new Error(`PREORDER fixture 至少需要兩個真實時段，實際取得 ${slots.length} 個。`);
    }
    firstPickupSlot = new Date(slots[0]).toISOString();
    secondPickupSlot = new Date(slots[1]).toISOString();

    const firstPickupAt = new Date(firstPickupSlot);
    const secondPickupAt = new Date(secondPickupSlot);
    const availableBeforeFirst = new Date(firstPickupAt.getTime() - 60_000);
    const availableAfterFirst = new Date(firstPickupAt.getTime() + 60_000);
    const availableAfterSecond = new Date(secondPickupAt.getTime() + 60_000);

    const qr = await prisma.qrCode.create({
      data: {
        organizationId,
        stallId,
        token: qrToken,
        label: `PREORDER shared E2E ${marker}`,
        state: "ACTIVE",
        tokenVersion: (qrVersion._max.tokenVersion ?? 0) + 1,
        fulfillmentTypeContext: "TAKEOUT",
      },
      select: { id: true },
    });
    fixtureQrId = qr.id;

    const noteGroup = await prisma.productNoteGroup.create({
      data: {
        organizationId,
        name: noteGroupName,
        selectionMode: "SINGLE",
        isRequired: true,
        minSelections: 1,
        maxSelections: 1,
        sortOrder: 9_999,
        options: {
          create: {
            organizationId,
            name: noteOptionName,
            priceDelta: 5,
            sortOrder: 0,
          },
        },
      },
      select: { id: true, options: { select: { id: true } } },
    });
    noteGroupId = noteGroup.id;
    noteOptionId = noteGroup.options[0]?.id ?? "";
    if (!noteOptionId) throw new Error("PREORDER fixture 未建立必選註記選項。");

    const [retainedProduct, prunedProduct] = await prisma.$transaction([
      prisma.product.create({
        data: {
          organizationId,
          categoryId: sourceProduct.product.categoryId,
          name: retainedProductName,
          description: "跨時段保留與跨角色驗證商品",
          defaultPrice: 130,
          kind: "SINGLE",
          isActive: true,
          sortOrder: 9_998,
        },
        select: { id: true },
      }),
      prisma.product.create({
        data: {
          organizationId,
          categoryId: sourceProduct.product.categoryId,
          name: prunedProductName,
          description: "只在第一個預約時段供應的購物車清除商品",
          defaultPrice: 100,
          kind: "SINGLE",
          isActive: true,
          sortOrder: 9_999,
        },
        select: { id: true },
      }),
    ]);
    retainedProductId = retainedProduct.id;
    prunedProductId = prunedProduct.id;

    await prisma.$transaction([
      prisma.stallProduct.create({
        data: {
          organizationId,
          stallId,
          productId: retainedProductId,
          isEnabled: true,
          isSoldOut: false,
          availableFrom: availableBeforeFirst,
          availableUntil: availableAfterSecond,
          sortOrder: 9_998,
        },
      }),
      prisma.stallProduct.create({
        data: {
          organizationId,
          stallId,
          productId: prunedProductId,
          isEnabled: true,
          isSoldOut: false,
          availableFrom: availableBeforeFirst,
          availableUntil: availableAfterFirst,
          sortOrder: 9_999,
        },
      }),
      prisma.productNoteGroupAssignment.create({
        data: {
          organizationId,
          productId: retainedProductId,
          noteGroupId,
          sortOrder: 0,
          isActive: true,
        },
      }),
    ]);
  });

  test.afterAll(async () => {
    try {
      await resolveCreatedRecords();
      if (createdSessionId) {
        await prisma.publicOrderAttempt.deleteMany({ where: { orderSessionId: createdSessionId } });
        await prisma.orderSession.deleteMany({ where: { id: createdSessionId } });
      }
      if (createdOrderId) await prisma.order.deleteMany({ where: { id: createdOrderId } });
      if (fixtureQrId) await prisma.qrCode.deleteMany({ where: { id: fixtureQrId } });
      if (retainedProductId || prunedProductId) {
        await prisma.product.deleteMany({
          where: { id: { in: [retainedProductId, prunedProductId].filter(Boolean) } },
        });
      }
      if (noteGroupId) await prisma.productNoteGroup.deleteMany({ where: { id: noteGroupId } });

      if (originalSettings) {
        await prisma.stallOrderingSettings.update({ where: { stallId }, data: originalSettings });
      }
      if (originalStall) await prisma.stall.update({ where: { id: stallId }, data: originalStall });
      await Promise.all(originalHours.map((hour) => prisma.stallBusinessHour.update({
        where: { id: hour.id },
        data: { opensAt: hour.opensAt, closesAt: hour.closesAt, isClosed: hour.isClosed },
      })));
    } finally {
      await prisma.$disconnect();
    }
  });

  test("套用第二時段後清除失效餐點，DB、Staff、KDS 與 Tracker 維持同一預約單", async ({ browser, page }) => {
    test.setTimeout(180_000);

    const sessionResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-order-session")
      && response.request().method() === "POST"
    ));
    await page.goto("/s/aming-chicken");
    const sessionResponse = await sessionResponsePromise;
    expect([200, 201]).toContain(sessionResponse.status());
    expect(sessionResponse.request().postDataJSON()).toMatchObject({
      qrToken,
      orderingMode: "PREORDER",
    });
    const sessionPayload = await sessionResponse.json() as {
      orderSessionToken?: string;
      orderingMode?: string;
      preorderSlots?: string[];
    };
    expect(sessionPayload).toMatchObject({ orderingMode: "PREORDER" });
    expect(sessionPayload.preorderSlots?.map((slot) => new Date(slot).getTime())).toEqual(
      expect.arrayContaining([
        new Date(firstPickupSlot).getTime(),
        new Date(secondPickupSlot).getTime(),
      ]),
    );
    expect(sessionPayload.orderSessionToken).toEqual(expect.any(String));
    const sessionTokenHash = createHash("sha256")
      .update(sessionPayload.orderSessionToken as string)
      .digest("hex");
    createdSessionId = (await prisma.orderSession.findUniqueOrThrow({
      where: { tokenHash: sessionTokenHash },
      select: { id: true },
    })).id;

    await selectPickupSlot(page, firstPickupSlot);
    await page.getByRole("button", { name: "套用這個時間", exact: true }).click();

    const prunedProduct = page.locator(`article#qr-product-${prunedProductId}`);
    const retainedProduct = page.locator(`article#qr-product-${retainedProductId}`);
    await expect(prunedProduct).toContainText(prunedProductName);
    await expect(retainedProduct).toContainText(retainedProductName);
    await prunedProduct.getByRole("button", { name: `增加 ${prunedProductName}` }).click();
    await retainedProduct.getByRole("button", { name: `增加 ${retainedProductName}` }).click();
    await retainedProduct.getByRole("radio", { name: new RegExp(noteOptionName, "u") }).check();
    await retainedProduct.getByRole("button", { name: "加入購物車", exact: true }).click();

    const cart = page.getByTestId("qr-cart-panel");
    await expect(cart.getByTestId("qr-cart-line")).toHaveCount(2);
    await expect(cart).toContainText(prunedProductName);
    await expect(cart).toContainText(retainedProductName);
    await expect(cart).toContainText(noteOptionName);

    await selectPickupSlot(page, secondPickupSlot);
    await expect(page.getByTestId("qr-checkout-blocker")).toHaveText(
      "取餐時間尚未套用，請先按下「套用這個時間」。",
    );
    await expect(page.getByRole("button", { name: "送出訂單", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "套用這個時間", exact: true }).click();

    await expect(prunedProduct).toHaveCount(0);
    await expect(cart.getByTestId("qr-cart-line")).toHaveCount(1);
    await expect(cart).not.toContainText(prunedProductName);
    await expect(cart).toContainText(retainedProductName);
    await expect(cart).toContainText(noteOptionName);

    const continueButton = page.getByRole("button", { name: "繼續填寫訂購資料", exact: true });
    if (await continueButton.isVisible()) await continueButton.click();
    await page.getByLabel("顧客稱呼").fill(customerName);
    const waitAcknowledgment = page.getByRole("checkbox", { name: /我已了解目前預估等候時間/u });
    if (await waitAcknowledgment.isVisible()) await waitAcknowledgment.check();

    let createOrderResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname.endsWith("/create-public-order")
      && response.request().method() === "POST"
    ));
    const submitOrder = page.getByRole("button", { name: "送出訂單", exact: true });
    await expect(submitOrder).toBeEnabled({ timeout: 20_000 });
    await submitOrder.click();
    let createOrderResponse = await createOrderResponsePromise;
    if (createOrderResponse.status() === 422) {
      await expect(createOrderResponse.json()).resolves.toMatchObject({ code: "WAIT_ACKNOWLEDGMENT_REQUIRED" });
      await expect(waitAcknowledgment).toBeVisible();
      await waitAcknowledgment.check();
      await expect(submitOrder).toBeEnabled({ timeout: 20_000 });
      createOrderResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith("/create-public-order")
        && response.request().method() === "POST"
      ));
      await submitOrder.click();
      createOrderResponse = await createOrderResponsePromise;
    }
    expect(createOrderResponse.status()).toBe(201);
    const createOrderRequest = createOrderResponse.request().postDataJSON() as {
      clientOrderId?: string;
      scheduledPickupAt?: string;
    };
    expect(createOrderRequest).toMatchObject({
      qrToken,
      orderingMode: "PREORDER",
      customerName,
      items: [{
        productId: retainedProductId,
        quantity: 1,
        noteOptionIds: [noteOptionId],
      }],
    });
    expect(createOrderRequest.scheduledPickupAt).toEqual(expect.any(String));
    expect(Date.parse(createOrderRequest.scheduledPickupAt as string)).toBe(Date.parse(secondPickupSlot));
    const clientOrderId = createOrderRequest.clientOrderId;
    expect(clientOrderId).toEqual(expect.any(String));
    if (!clientOrderId) throw new Error("create-public-order request 缺少 clientOrderId");

    await expect(page).toHaveURL(/\/order\/sto_[A-Za-z0-9_-]+$/u);
    const trackingToken = decodeURIComponent(
      new URL(page.url()).pathname.replace(/^\/order\//u, ""),
    );
    expect(trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/u);
    const trackingTokenHash = createHash("sha256").update(trackingToken).digest("hex");

    const createdOrder = await prisma.order.findUniqueOrThrow({
      where: { id: clientOrderId },
      select: {
        id: true,
        orderNo: true,
        trackingTokenHash: true,
        customerName: true,
        source: true,
        origin: true,
        fulfillmentType: true,
        status: true,
        scheduledPickupAt: true,
        requestedFulfillmentAt: true,
        committedFulfillmentAt: true,
        fulfillmentTimeState: true,
        fulfillmentTimeVersion: true,
        orderSession: {
          select: { id: true, orderingMode: true, requestedFulfillmentAt: true },
        },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            productId: true,
            name: true,
            quantity: true,
            noteOptions: {
              select: { noteOptionId: true, groupName: true, optionName: true, priceDelta: true },
            },
          },
        },
      },
    });
    createdOrderId = createdOrder.id;
    const orderNo = createdOrder.orderNo;
    expect(createdOrder).toMatchObject({
      id: clientOrderId,
      orderNo,
      trackingTokenHash,
      customerName,
      source: "QR_MENU",
      origin: "ONLINE_QR",
      fulfillmentType: "TAKEOUT",
      status: "WAITING_CONFIRMATION",
      fulfillmentTimeState: "REQUESTED",
      fulfillmentTimeVersion: 1,
      committedFulfillmentAt: null,
      orderSession: {
        id: createdSessionId,
        orderingMode: "PREORDER",
      },
      items: [{
        productId: retainedProductId,
        name: retainedProductName,
        quantity: 1,
        noteOptions: [{
          noteOptionId,
          groupName: noteGroupName,
          optionName: noteOptionName,
          priceDelta: 5,
        }],
      }],
    });
    expect(createdOrder.scheduledPickupAt?.toISOString()).toBe(secondPickupSlot);
    expect(createdOrder.requestedFulfillmentAt?.toISOString()).toBe(secondPickupSlot);
    expect(createdOrder.orderSession?.requestedFulfillmentAt?.toISOString()).toBe(secondPickupSlot);

    await expect(page.getByText(`訂單 ${orderNo}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "預計取餐時間", exact: true })).toBeVisible();
    await expect(page.getByText("等待店家確認", { exact: true })).toBeVisible();
    await expect(page.getByText(retainedProductName, { exact: false })).toBeVisible();
    await expect(page.getByText(`${noteGroupName}：${noteOptionName}`, { exact: true })).toBeVisible();
    await expect(page.getByText(prunedProductName, { exact: false })).toHaveCount(0);

    const staffContext = await browser.newContext({ locale: "zh-TW", timezoneId: testTimeZone });
    try {
      const staffPage = await staffContext.newPage();
      await login(staffPage, "staff@stallorder.test");
      await staffPage.goto("/staff/aming-chicken");
      const staffOrder = staffPage.getByRole("article").filter({ hasText: customerName });
      await expect(staffOrder).toBeVisible();
      await expect(staffOrder).toContainText(`訂單 ${orderNo}`);
      await expect(staffOrder).toContainText(retainedProductName);
      await expect(staffOrder).toContainText(noteOptionName);
      await expect(staffOrder).not.toContainText(prunedProductName);
      await expect(staffOrder).toContainText("顧客希望取餐");

      const acceptTimeResponsePromise = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith(`/orders/${createdOrderId}/fulfillment-time`)
        && response.request().method() === "PATCH"
      ));
      await staffOrder.getByRole("button", { name: "接受原時間", exact: true }).click();
      const acceptTimeResponse = await acceptTimeResponsePromise;
      const acceptTimeBody = await acceptTimeResponse.json().catch(() => null);
      const acceptTimeDbOrder = await prisma.order.findUnique({
        where: { id: createdOrderId },
        select: {
          stallId: true,
          status: true,
          fulfillmentTimeState: true,
          fulfillmentTimeVersion: true,
        },
      });
      expect(acceptTimeResponse.status(), JSON.stringify({
        url: acceptTimeResponse.url(),
        requestId: acceptTimeResponse.headers()["x-request-id"] ?? null,
        response: acceptTimeBody,
        dbOrder: acceptTimeDbOrder,
      })).toBe(200);
      expect(acceptTimeResponse.request().postDataJSON()).toEqual({
        operation: "CONFIRM_REQUESTED",
        version: 1,
      });
      await expect(staffOrder).toContainText("已確認取餐");

      const confirmOrderResponsePromise = staffPage.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith(`/orders/${createdOrderId}`)
        && response.request().method() === "PATCH"
      ));
      await staffOrder.getByRole("button", { name: "確認接單", exact: true }).click();
      const confirmOrderResponse = await confirmOrderResponsePromise;
      expect(confirmOrderResponse.status()).toBe(200);
      expect(confirmOrderResponse.request().postDataJSON()).toMatchObject({ status: "CONFIRMED" });
      await expect(staffOrder).toContainText("待製作");
      await expect(staffOrder.getByRole("button", { name: "確認接單", exact: true })).toHaveCount(0);

      await expect.poll(async () => prisma.order.findUniqueOrThrow({
        where: { id: createdOrderId },
        select: {
          status: true,
          scheduledPickupAt: true,
          requestedFulfillmentAt: true,
          committedFulfillmentAt: true,
          fulfillmentTimeState: true,
          productionTasks: {
            select: {
              orderId: true,
              orderItem: { select: { productId: true, name: true } },
              station: { select: { id: true, isActive: true } },
            },
          },
        },
      })).toMatchObject({
        status: "CONFIRMED",
        scheduledPickupAt: new Date(secondPickupSlot),
        requestedFulfillmentAt: new Date(secondPickupSlot),
        committedFulfillmentAt: new Date(secondPickupSlot),
        fulfillmentTimeState: "CONFIRMED",
        productionTasks: [{
          orderId: createdOrderId,
          orderItem: { productId: retainedProductId, name: retainedProductName },
          station: { isActive: true },
        }],
      });

      const kitchenContext = await browser.newContext({ locale: "zh-TW", timezoneId: testTimeZone });
      try {
        const kitchenPage = await kitchenContext.newPage();
        await login(kitchenPage, "kitchen@stallorder.test");
        await kitchenPage.goto("/kitchen?stall=aming-chicken");
        const kitchenOrder = kitchenPage.getByRole("article").filter({ hasText: `#${orderNo}` });
        await expect(kitchenOrder).toBeVisible();
        await expect(kitchenOrder).toContainText("外帶自取 · QR 點餐");
        await expect(kitchenOrder).toContainText("預約時間：");
        await expect(kitchenOrder).toContainText(retainedProductName);
        await expect(kitchenOrder).toContainText(noteOptionName);
        await expect(kitchenOrder).not.toContainText(prunedProductName);
      } finally {
        await kitchenContext.close();
      }
    } finally {
      await staffContext.close();
    }

    await page.getByRole("button", { name: "重新整理訂單" }).click();
    await expect(page.getByText("攤位已確認", { exact: true })).toBeVisible();
    await expect(page.getByText("時間已確認", { exact: true })).toBeVisible();
    await expect(page.getByText(retainedProductName, { exact: false })).toBeVisible();
    await expect(page.getByText(prunedProductName, { exact: false })).toHaveCount(0);
  });
});

async function selectPickupSlot(page: Page, iso: string) {
  const slot = buildFulfillmentTimeSlots([iso], testTimeZone)[0];
  if (!slot) throw new Error(`PREORDER 時段 ${iso} 不是有效的 5 分鐘單位。`);
  const fields = page.getByTestId("qr-preorder-fulfillment-time-fields");
  await fields.getByLabel("預約取餐日期").fill(slot.date);
  await fields.getByLabel("預約取餐時間－時").selectOption(slot.hour);
  await fields.getByLabel("預約取餐時間－分").selectOption(slot.minute);
}

function currentHourInTimeZone(timeZone: string) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).find((part) => part.type === "hour")?.value;
  if (hour === undefined) throw new Error(`無法取得 ${timeZone} 的目前小時。`);
  return Number(hour);
}

async function resolveCreatedRecords() {
  if (!createdOrderId) {
    createdOrderId = (await prisma.order.findFirst({
      where: { stallId, customerName },
      select: { id: true },
    }))?.id ?? "";
  }
  if (!createdSessionId && createdOrderId) {
    createdSessionId = (await prisma.orderSession.findUnique({
      where: { orderId: createdOrderId },
      select: { id: true },
    }))?.id ?? "";
  }
  if (!fixtureQrId) {
    fixtureQrId = (await prisma.qrCode.findUnique({
      where: { token: qrToken },
      select: { id: true },
    }))?.id ?? "";
  }
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "使用電子郵件與密碼登入", exact: true }).click();
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼").fill(password);
  const loginResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "登入", exact: true }).click();
  expect((await loginResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/staff\/|\/kitchen\?/u, { timeout: 30_000 });
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
