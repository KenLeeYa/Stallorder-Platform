import { test, expect, type BrowserContext, type Page, type APIResponse, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { StaffOrderDto } from "../src/lib/orders";

test.describe.configure({ mode: "serial" });
test.use({ browserName: process.env.LOCAL_QA_BROWSER === "webkit" ? "webkit" : "chromium" });
test.skip(process.env.LOCAL_CATALOG_AMENDMENTS_QA !== "true", "Explicit local QA only; fixtures remain for manual testing.");
const base = process.env.PLAYWRIGHT_APP_URL ?? "";
const org = "11111111-1111-4111-8111-111111111111";
const stall = "22222222-2222-4222-8222-222222222222";
const catalogUrl = `/api/merchant/stalls/${stall}/products`;
const printUrl = "/api/stalls/aming-chicken/print-jobs";
const stamp = Date.now().toString().slice(-8);
let db: PrismaClient, context: BrowserContext, page: Page;
let headers: Record<string, string>;
let categoryId: string, normal: string, side: string, custom: string, bundle: string, option: string, choice: string;
let printerId: string;
let savedCapacity: { maxOrdersPerWindow: number; maxItemsPerWindow: number; autoResumeEnabled: boolean } | undefined;
const orders: Array<{ id: string; orderNo: string; scenario: string }> = [];
const errors: string[] = [];

async function waitForHydratedControl(control: Locator) {
  await expect.poll(() => control.evaluate(element => Object.entries(element).some(([key, value]) =>
    key.startsWith("__reactProps$") && typeof (value as { onClick?: unknown }).onClick === "function")),
  { message: "等待 React 控制項完成 hydration" }).toBe(true);
}

async function result(response: Pick<APIResponse, "text" | "status" | "url">, status = 200) {
  const text = await response.text();
  expect(text, `${response.status()} ${response.url()}`).not.toBe("");
  const body = JSON.parse(text);
  expect(response.status(), JSON.stringify(body)).toBe(status);
  return body;
}
async function availability(mode: string, extra = {}, productIds = [normal]) {
  return result(await context.request.patch(catalogUrl, { headers, data: { operation: "BULK_AVAILABILITY", productIds, mode, ...extra } }));
}
async function assignment(productId = normal) {
  return db.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId: stall, productId } } });
}
async function menu() {
  const body = await result(await context.request.get("/api/public/stalls/aming-chicken/menu"));
  return body.menu ?? body;
}
async function createOrder(scenario: string, items: Array<{ productId: string; quantity: number; noteOptionIds?: string[]; bundleChoiceIds?: string[] }> = [{ productId: normal, quantity: 2 }, { productId: side, quantity: 1 }]) {
  const body = await result(await context.request.post("/api/stalls/aming-chicken/orders", { headers, data: {
    idempotencyKey: randomUUID(), customerName: `QA ${scenario} ${stamp}`, customerNote: "本機流程測試，請勿實際製作", paymentTiming: "PAY_LATER", fulfillmentType: "TAKEOUT", items,
  } }), 201);
  orders.push({ id: body.order.id, orderNo: body.order.orderNo, scenario });
  return body.order as StaffOrderDto;
}
async function printCommand(data: Record<string, unknown>) {
  return result(await context.request.post(printUrl, { headers, data }));
}
async function currentOrder(id: string) {
  const body = await result(await context.request.get("/api/stalls/aming-chicken/orders"));
  const order = body.orders.find((row: StaffOrderDto) => row.id === id);
  expect(order).toBeTruthy();
  return order as StaffOrderDto;
}
async function patchOrder(order: StaffOrderDto, items: unknown[], extra = {}) {
  const data = { changeId: randomUUID(), expectedUpdatedAt: order.updatedAt, items, ...extra };
  const response = await context.request.patch(`/api/stalls/aming-chicken/orders/${order.id}/content`, { headers, data });
  return { response, data };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const database = new URL(process.env.DATABASE_URL!);
  const retainedTarget = base === "http://127.0.0.1:3018" && database.pathname === "/postgres";
  const releaseTarget = base === "http://127.0.0.1:3028" && database.pathname === "/stallorder_release_primary_20260912";
  if ((!retainedTarget && !releaseTarget) || database.hostname !== "127.0.0.1" || database.port !== "55722") throw new Error("LOCAL_QA_TARGET_MISMATCH");
  db = new PrismaClient();
  context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  page = await context.newPage(); page.setDefaultTimeout(15_000); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: "商家", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/dashboard/);
  headers = { origin: base, "x-csrf-token": (await context.cookies()).find((cookie) => cookie.name === "stallorder_csrf")!.value };
  savedCapacity = await db.stallCapacitySettings.findUniqueOrThrow({ where: { stallId: stall }, select: { maxOrdersPerWindow: true, maxItemsPerWindow: true, autoResumeEnabled: true } });
  await db.stallCapacitySettings.update({ where: { stallId: stall }, data: { maxOrdersPerWindow: 1000, maxItemsPerWindow: 5000, autoResumeEnabled: true } });
  await db.$queryRaw`select public.refresh_stall_capacity(${stall}::uuid, true, 'LOCAL_CATALOG_SUITE')`;
  categoryId = (await db.productCategory.create({ data: { organizationId: org, name: `QA 供應與改單 ${stamp}`, sortOrder: 0 } })).id;
  async function product(name: string, price: number, kind: "SINGLE" | "BUNDLE" = "SINGLE") {
    return (await db.product.create({ data: { organizationId: org, categoryId, name: `QA ${name} ${stamp}`, description: "本機測試資料", defaultPrice: price, kind,
      stallProducts: { create: { organizationId: org, stallId: stall, isEnabled: true, stockRemaining: 100 } },
    } })).id;
  }
  normal = await product("主餐", 100); side = await product("配菜", 30); custom = await product("客製主餐", 80); bundle = await product("套餐", 150, "BUNDLE");
  const group = await db.productNoteGroup.create({ data: { organizationId: org, name: `QA 必選口味 ${stamp}`, selectionMode: "SINGLE", isRequired: true, minSelections: 1, maxSelections: 1,
    options: { create: { organizationId: org, name: "不加辣加料", priceDelta: 5 } }, assignments: { create: { organizationId: org, productId: custom } },
  }, include: { options: true } }); option = group.options[0].id;
  const bundleGroup = await db.productBundleChoiceGroup.create({ data: { organizationId: org, bundleProductId: bundle, name: "選擇配菜", minSelections: 1, maxSelections: 1,
    choices: { create: { organizationId: org, componentProductId: side, quantity: 1, priceDelta: 10 } },
  }, include: { choices: true } }); choice = bundleGroup.choices[0].id;
  printerId = (await db.printer.findFirstOrThrow({ where: { stallId: stall, isEnabled: true, connectionType: "SYSTEM_PRINT" } })).id;
});

test.afterAll(async () => {
  if (savedCapacity) {
    await db.stallCapacitySettings.update({ where: { stallId: stall }, data: savedCapacity });
    await db.$queryRaw`select public.refresh_stall_capacity(${stall}::uuid, true, 'LOCAL_CATALOG_SUITE_RESTORED')`;
  }
  if (process.env.LOCAL_QA_EVIDENCE && normal) writeFileSync(process.env.LOCAL_QA_EVIDENCE + "/local-fixtures.json", JSON.stringify({ stamp, categoryId, products: { normal, side, custom, bundle }, option, choice, orders, pageErrors: errors }, null, 2));
  await context?.close(); await db?.$disconnect();
});

test("供應設定期限、跨日恢復、永久下架、庫存與編輯資料互不覆寫", async () => {
  test.setTimeout(120_000);
  await availability("TODAY");
  let row = await assignment();
  expect(row.isSoldOut).toBe(true); expect(row.soldOutUntil!.getTime()).toBeGreaterThan(Date.now());
  const expected = await db.$queryRaw<Array<{ until: Date }>>`select public.product_next_service_day(${stall}::uuid) as until`;
  expect(row.soldOutUntil).toEqual(expected[0].until); expect(row.stockRemaining).toBe(100);
  await result(await context.request.post(`/api/merchant/organizations/${org}/catalog`, { headers, data: {
    operation: "UPDATE_PRODUCT", productId: normal, categoryId, groupId: null, name: `QA 主餐 ${stamp}`, description: "只修改商品說明", defaultPrice: 100, imageUrl: null, sortOrder: 0,
  } }));
  expect((await assignment()).soldOutUntil).toEqual(row.soldOutUntil);
  await availability("TEMPORARY", { minutes: 15 });
  row = await assignment(); expect(row.soldOutUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
  const futureDate = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  await availability("UNTIL_DATE", { resumeDate: futureDate });
  expect((await assignment()).soldOutUntil).toEqual(new Date(futureDate + "T00:00:00+08:00"));
  const expired = new Date(Date.now() - 1000);
  await db.stallProduct.update({ where: { id: row.id }, data: { soldOutUntil: expired } });
  const merchantProducts = await result(await context.request.get(catalogUrl));
  expect(merchantProducts.products.find((item: { productId: string }) => item.productId === normal).isSoldOut).toBe(false);
  expect((await menu()).products.find((item: { id: string }) => item.id === normal).isSoldOut).toBe(false);
  await db.stallProduct.update({ where: { id: row.id }, data: { stockRemaining: 0 } });
  expect((await menu()).products.find((item: { id: string }) => item.id === normal).isSoldOut).toBe(true);
  await availability("PERMANENT");
  expect((await menu()).products.some((item: { id: string }) => item.id === normal)).toBe(false);
  await result(await context.request.post(`/api/merchant/organizations/${org}/catalog`, { headers, data: {
    operation: "UPDATE_PRODUCT", productId: normal, categoryId, groupId: null, name: `QA 主餐 ${stamp}`, description: "下架後修改說明", defaultPrice: 100, imageUrl: null, sortOrder: 0,
  } }));
  expect((await assignment()).isEnabled).toBe(false);
  const invalid = await context.request.patch(catalogUrl, { headers, data: { operation: "BULK_AVAILABILITY", mode: "UNTIL_DATE", productIds: [normal], resumeDate: "2026-02-30" } });
  expect(invalid.status()).toBe(400);
  const unknown = await context.request.patch(catalogUrl, { headers, data: { operation: "BULK_AVAILABILITY", mode: "AVAILABLE", productIds: [normal, randomUUID()] } });
  expect(unknown.status()).toBe(404); expect((await assignment()).isEnabled).toBe(false);
  const csrf = await context.request.patch(catalogUrl, { headers: { origin: base }, data: { operation: "BULK_AVAILABILITY", mode: "AVAILABLE", productIds: [normal] } });
  expect(csrf.status()).toBe(403);
  await availability("AVAILABLE"); expect((await assignment()).stockRemaining).toBe(0);
  await db.stallProduct.update({ where: { id: row.id }, data: { stockRemaining: 100 } });
});

test("已列印訂單同單號增減、保留原價、客製加餐、變更單與重送去重", async () => {
  test.setTimeout(150_000);
  const created = await createOrder("已印完增減");
  const original = await db.printJob.findFirstOrThrow({ where: { orderId: created.id, amendmentId: null, reprintOfId: null } });
  await printCommand({ operation: "CLAIM", jobId: original.id, printerId });
  await printCommand({ operation: "SUCCESS", jobId: original.id });
  const frozen = (await db.printJob.findUniqueOrThrow({ where: { id: original.id } })).payload;
  await db.product.update({ where: { id: normal }, data: { defaultPrice: 110 } });
  const order = await currentOrder(created.id);
  const originalMain = order.items.find((item) => item.name === `QA 主餐 ${stamp}`)!;
  const submitted = await patchOrder(order, [
    { kind: "EXISTING", itemId: originalMain.id, quantity: 1 },
    { kind: "NEW", productId: custom, quantity: 1, note: "醬料分開", noteOptionIds: [option] },
    { kind: "NEW", productId: bundle, quantity: 1, bundleChoiceIds: [choice] },
  ]);
  const changed = (await result(submitted.response)).order as StaffOrderDto;
  expect(changed.id).toBe(created.id); expect(changed.orderNo).toBe(created.orderNo); expect(changed.total).toBe(345);
  expect(changed.items.find((item) => item.id === originalMain.id)?.unitPrice).toBe(100);
  expect(changed.items.some((item) => item.name === `QA 配菜 ${stamp}`)).toBe(false);
  expect((await assignment(normal)).stockRemaining).toBe(99);
  expect((await assignment(custom)).stockRemaining).toBe(99);
  expect((await db.printJob.findUniqueOrThrow({ where: { id: original.id } })).payload).toEqual(frozen);
  const jobs = await db.printJob.findMany({ where: { orderId: created.id, amendmentId: submitted.data.changeId } });
  expect(jobs).toHaveLength(1);
  const payload = jobs[0].payload as { content: string; dataBase64: string };
  expect(payload.content).toContain("訂單變更單 #1"); expect(payload.content).toContain("勿製作"); expect(payload.content).toContain("加做"); expect(payload.content).toContain("醬料分開");
  expect(payload.content).toContain("不加辣加料"); expect(payload.dataBase64.length).toBeGreaterThan(100);
  const replay = await context.request.patch(`/api/stalls/aming-chicken/orders/${created.id}/content`, { headers, data: submitted.data });
  await result(replay); expect(await db.printJob.count({ where: { orderId: created.id, amendmentId: submitted.data.changeId } })).toBe(1);
  expect(await db.orderEvent.count({ where: { id: submitted.data.changeId } })).toBe(1);
  const stale = await patchOrder(order, [{ kind: "EXISTING", itemId: originalMain.id, quantity: 2 }]);
  expect((await result(stale.response, 409)).code).toBe("ORDER_CONFLICT");
  await printCommand({ operation: "CLAIM", jobId: jobs[0].id, printerId });
  await printCommand({ operation: "FAIL", jobId: jobs[0].id, error: "QA 模擬印表機斷線" });
  await printCommand({ operation: "REPRINT", jobId: jobs[0].id });
  const retry = await db.printJob.findFirstOrThrow({ where: { reprintOfId: jobs[0].id } });
  expect(retry.amendmentId).toBe(submitted.data.changeId); expect(retry.payload).toEqual(jobs[0].payload);
  await printCommand({ operation: "CLAIM", jobId: retry.id, printerId }); await printCommand({ operation: "SUCCESS", jobId: retry.id });
  const tasks = await db.orderProductionTask.findMany({ where: { orderId: created.id } });
  expect(tasks).toHaveLength(3);
  expect(tasks.every((task) => changed.items.some((item) => item.id === task.orderItemId))).toBe(true);
  if (process.env.LOCAL_QA_EVIDENCE) writeFileSync(process.env.LOCAL_QA_EVIDENCE + "/amendment-ticket.txt", payload.content);
  const secondOrder = await currentOrder(created.id);
  const second = await patchOrder(secondOrder, secondOrder.items.filter((item) => item.name !== `QA 客製主餐 ${stamp}`).map((item) => ({ kind: "EXISTING", itemId: item.id, quantity: item.quantity })));
  await result(second.response);
  const secondJob = await db.printJob.findFirstOrThrow({ where: { orderId: created.id, amendmentId: second.data.changeId } });
  expect((secondJob.payload as { content: string }).content).toContain(`【勿製作】QA 客製主餐`);
  expect((await currentOrder(created.id)).primaryPrintStatus).toBe("PENDING");
});

test("列印中與失敗仍可改單，庫存不足與製作中拒絕時整筆回復", async () => {
  test.setTimeout(150_000);
  for (const state of ["PRINTING", "FAILED"] as const) {
    const order = await createOrder(state, [{ productId: normal, quantity: 2 }]);
    const job = await db.printJob.findFirstOrThrow({ where: { orderId: order.id, amendmentId: null, reprintOfId: null } });
    await printCommand({ operation: "CLAIM", jobId: job.id, printerId });
    if (state === "FAILED") await printCommand({ operation: "FAIL", jobId: job.id, error: "QA 模擬斷線" });
    const current = await currentOrder(order.id);
    const patch = await patchOrder(current, [{ kind: "EXISTING", itemId: current.items[0].id, quantity: 1 }]);
    await result(patch.response); expect(await db.printJob.count({ where: { orderId: order.id, amendmentId: patch.data.changeId } })).toBe(1);
  }
  const order = await createOrder("庫存不足回復", [{ productId: normal, quantity: 1 }]);
  const stock = await assignment(normal);
  await db.stallProduct.update({ where: { id: stock.id }, data: { stockRemaining: 0 } });
  const before = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, printJobs: true } });
  const failed = await patchOrder(order, [{ kind: "EXISTING", itemId: order.items[0].id, quantity: 2 }]);
  expect((await result(failed.response, 409)).code).toBe("PRODUCT_STOCK_INSUFFICIENT");
  const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, printJobs: true } });
  expect(after).toEqual(before); expect(await db.orderEvent.count({ where: { id: failed.data.changeId } })).toBe(0);
  await db.stallProduct.update({ where: { id: stock.id }, data: { stockRemaining: stock.stockRemaining } });
  await db.orderItem.update({ where: { id: order.items[0].id }, data: { status: "PREPARING" } });
  const started = await currentOrder(order.id);
  const rejected = await patchOrder(started, [{ kind: "EXISTING", itemId: started.items[0].id, quantity: 2 }]);
  expect((await result(rejected.response, 409)).code).toBe("ORDER_ALREADY_STARTED");
});

test("電腦平板手機供應選單與勾選控制正常，巢狀視窗保持編輯位置", async () => {
  test.setTimeout(150_000);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/merchant/catalog?organizationId=${org}`);
    if (width < 768) {
      await waitForHydratedControl(page.getByTestId("open-catalog-navigator"));
      await page.getByTestId("open-catalog-navigator").click();
      await page.getByTestId("catalog-navigator-dialog").getByRole("searchbox").fill(`QA 主餐 ${stamp}`);
      await page.getByRole("button", { name: `操作：QA 主餐 ${stamp}`, exact: true }).click();
    }
    const scope = width < 768 ? page.getByTestId("catalog-navigator-dialog") : page.getByRole("region", { name: "商品批次管理" });
    const status = scope.getByRole("button", { name: new RegExp(`QA 主餐 ${stamp}：.+設定供應狀態`) }).first();
    await waitForHydratedControl(status);
    await status.click();
    const dialog = page.getByRole("dialog", { name: "設定供應狀態" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "暫時停止供應", exact: false }).click();
    await expect(dialog.getByRole("button", { name: "15 分鐘", exact: true })).toBeVisible();
    const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.LOCAL_QA_EVIDENCE) await page.screenshot({ path: `${process.env.LOCAL_QA_EVIDENCE}/availability-${width}.png` });
    await dialog.getByRole("button", { name: "關閉供應狀態設定" }).click();
    if (width < 768) {
      await expect(page.getByTestId("catalog-navigator-dialog")).toBeVisible();
      await status.click(); await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0); await expect(page.getByTestId("catalog-navigator-dialog")).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test("QR 舊購物車售完時拒單，到期後可正常成立，永久下架仍拒單", async () => {
  test.setTimeout(90_000);
  const capacity = await db.stallCapacitySettings.findUniqueOrThrow({ where: { stallId: stall }, select: { maxOrdersPerWindow: true, maxItemsPerWindow: true, autoResumeEnabled: true } });
  const qrStates = await db.qrCode.findMany({ where: { stallId: stall }, select: { id: true, state: true } });
  const stallState = await db.stall.findUniqueOrThrow({ where: { id: stall }, select: { orderingState: true } });
  // Retained QA orders intentionally exercise overload protection. Isolate item availability under a higher local capacity, then restore it.
  await db.stallCapacitySettings.update({ where: { stallId: stall }, data: { maxOrdersPerWindow: 1000, maxItemsPerWindow: 5000, autoResumeEnabled: true } });
  await db.$queryRaw`select public.refresh_stall_capacity(${stall}::uuid, true, 'LOCAL_AVAILABILITY_QA')`;
  try {
  const qrToken = "demo-aming-chicken-table-a1-qr-2026"; let deviceId = randomUUID();
  const publicHeaders = () => ({ origin: base, "x-stallorder-protocol-version": "1", "x-stallorder-operation-id": randomUUID() });
  let session = await result(await context.request.post("/api/public/order-session", { headers: publicHeaders(), data: { qrToken, deviceId, orderingMode: "DEFAULT", sessionRequestId: randomUUID() } }), 201);
  const submit = () => context.request.post("/api/public/orders", { headers: publicHeaders(), data: {
    qrToken, deviceId, orderingMode: "DEFAULT", orderSessionToken: session.orderSessionToken,
    clientOrderId: randomUUID(), idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(), turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    customerName: `QA QR 供應恢復 ${stamp}`, customerPhone: "0912345678", waitAcknowledged: true, scheduledPickupAt: null,
    items: [{ productId: normal, quantity: 1 }],
  } });
  await availability("TODAY");
  const unavailable = await submit(); expect(unavailable.status()).toBeGreaterThanOrEqual(400); expect((await unavailable.json()).code).toBe("PRODUCT_UNAVAILABLE");
  const row = await assignment();
  await db.stallProduct.update({ where: { id: row.id }, data: { soldOutUntil: new Date(Date.now() - 1000) } });
  const resumed = await result(await submit(), 201);
  const created = await db.order.findFirstOrThrow({ where: { stallId: stall, customerName: `QA QR 供應恢復 ${stamp}` } });
  orders.push({ id: created.id, orderNo: created.orderNo, scenario: "QR 到期恢復" }); expect(resumed).toBeTruthy();
  deviceId = randomUUID();
  session = await result(await context.request.post("/api/public/order-session", { headers: publicHeaders(), data: { qrToken, deviceId, orderingMode: "DEFAULT", sessionRequestId: randomUUID() } }), 201);
  expect(session.products.find((item: { id: string }) => item.id === normal)?.isSoldOut).toBe(false);
  await availability("PERMANENT");
  const disabled = await submit(); expect(disabled.status()).toBeGreaterThanOrEqual(400); expect((await disabled.json()).code).toBe("PRODUCT_UNAVAILABLE");
  expect((await menu()).products.some((item: { id: string }) => item.id === normal)).toBe(false);
  await availability("AVAILABLE");
  } finally {
    await db.stallCapacitySettings.update({ where: { stallId: stall }, data: capacity });
    await db.$queryRaw`select public.refresh_stall_capacity(${stall}::uuid, true, 'LOCAL_AVAILABILITY_QA_RESTORED')`;
    await db.stall.update({ where: { id: stall }, data: stallState });
    for (const row of qrStates) await db.qrCode.update({ where: { id: row.id }, data: { state: row.state } });
  }
});

test("店員畫面可增刪已出單餐點並驗證必選註記", async () => {
  test.setTimeout(120_000);
  const created = await createOrder("店員介面改單", [{ productId: normal, quantity: 1 }]);
  const original = await db.printJob.findFirstOrThrow({ where: { orderId: created.id, amendmentId: null, reprintOfId: null } });
  await printCommand({ operation: "CLAIM", jobId: original.id, printerId });
  await printCommand({ operation: "SUCCESS", jobId: original.id });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/staff/aming-chicken");
  const ticket = page.getByTestId("staff-order-list-pane").getByRole("button").filter({ hasText: created.orderNo });
  await waitForHydratedControl(ticket);
  await ticket.click();
  await expect(ticket).toHaveAttribute("aria-current", "true");
  await page.getByTestId("staff-order-actions-pane").getByRole("button", { name: "修改訂單內容", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.locator("#order-edit-title") });
  await dialog.locator("#order-edit-product").selectOption(custom);
  const add = dialog.getByRole("button", { name: /^加入.*\$8/ });
  await expect(add).toBeDisabled();
  await dialog.getByRole("radio", { name: /不加辣加料/ }).check();
  await dialog.locator('input[maxlength="1000"]').fill("QA 介面加餐，醬料分開");
  await expect(add).toBeEnabled(); await add.click();
  await dialog.locator(".divide-y > div").filter({ hasText: `QA 主餐 ${stamp}` }).getByRole("button", { name: "移除", exact: true }).click();
  if (process.env.LOCAL_QA_EVIDENCE) await page.screenshot({ path: process.env.LOCAL_QA_EVIDENCE + "/staff-edit-dialog-1024.png" });
  const response = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/content"));
  await dialog.getByRole("button", { name: "儲存並同步廚房", exact: true }).click();
  const changed = (await result(await response)).order as StaffOrderDto;
  expect(changed.id).toBe(created.id); expect(changed.orderNo).toBe(created.orderNo); expect(changed.total).toBe(85);
  expect(changed.items).toHaveLength(1); expect(changed.items[0].note).toBe("QA 介面加餐，醬料分開");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("staff-order-items-pane")).toContainText(`QA 客製主餐 ${stamp}`);
  expect(errors).toEqual([]);
});
