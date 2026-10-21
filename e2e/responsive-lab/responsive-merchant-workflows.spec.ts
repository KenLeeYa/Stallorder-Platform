import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertResponsiveQaTarget } from "../../scripts/responsive-qa-target.mjs";
import { catalogCsvHeaders } from "../../src/lib/catalog-csv-client";
import { gotoLocalPath, loginLocalTestAccount } from "../local-navigation";

assertResponsiveQaTarget(process.env);

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const password = "StallOrderDemo!2026";
const prisma = new PrismaClient();
const fixtureName = `B1 售罄驗收 ${randomUUID().slice(0, 8)}`;
let fixtureProductId = "";
let fixtureQrId = "";
let fixtureQrToken = "";
let originalStall: { orderingState: "OPEN" | "PAUSED" | "CLOSED"; isSoldOut: boolean };
let originalHours: Awaited<ReturnType<typeof prisma.stallBusinessHour.findMany>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  assertResponsiveQaTarget(process.env);
  originalStall = await prisma.stall.findUniqueOrThrow({ where: { id: stallId }, select: { orderingState: true, isSoldOut: true } });
  originalHours = await prisma.stallBusinessHour.findMany({ where: { stallId } });
  await prisma.stall.update({ where: { id: stallId }, data: { orderingState: "OPEN", isSoldOut: false } });
  await prisma.stallBusinessHour.updateMany({ where: { stallId }, data: { opensAt: "00:00", closesAt: "23:59", lastOrderAt: null, isClosed: false } });
  const category = await prisma.productCategory.findFirstOrThrow({ where: { organizationId, isActive: true } });
  fixtureProductId = (await prisma.product.create({ data: {
    organizationId, categoryId: category.id, name: fixtureName, description: "B1 local availability fixture", defaultPrice: 60,
    stallProducts: { create: { organizationId, stallId, isEnabled: true, isSoldOut: false } },
  } })).id;
  const version = await prisma.qrCode.aggregate({ where: { stallId }, _max: { tokenVersion: true } });
  fixtureQrToken = randomBytes(32).toString("base64url");
  fixtureQrId = (await prisma.qrCode.create({ data: {
    organizationId, stallId, token: fixtureQrToken, label: "B1 local QA", state: "ACTIVE", tokenVersion: (version._max.tokenVersion ?? 0) + 1,
  } })).id;
});

test.afterAll(async () => {
  if (fixtureQrId) {
    await prisma.orderSession.deleteMany({ where: { qrCodeId: fixtureQrId } });
    await prisma.qrCode.deleteMany({ where: { id: fixtureQrId } });
  }
  if (fixtureProductId) {
    await prisma.stallProduct.deleteMany({ where: { productId: fixtureProductId } });
    await prisma.product.deleteMany({ where: { id: fixtureProductId } });
  }
  for (const hour of originalHours ?? []) {
    await prisma.stallBusinessHour.update({ where: { id: hour.id }, data: {
      opensAt: hour.opensAt, closesAt: hour.closesAt, lastOrderAt: hour.lastOrderAt, isClosed: hour.isClosed,
    } });
  }
  if (originalStall) await prisma.stall.update({ where: { id: stallId }, data: originalStall });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await loginLocalTestAccount(page, "owner@stallorder.test", password);
});

test("tablet shows all authorized functions without directory button", async ({ page }) => {
  await gotoLocalPath(page, `/merchant/dashboard?organizationId=${organizationId}`);
  const navigation = page.getByTestId("merchant-function-navigation");
  const allFunctionsButton = navigation.getByRole("button", { name: "所有功能" });
  for (const width of [768, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(allFunctionsButton).toBeHidden();
    for (const link of await navigation.getByRole("link").all()) {
      await expect(link).toBeVisible();
      expect(await link.getAttribute("aria-label")).toBeTruthy();
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(allFunctionsButton).toBeVisible();
  await allFunctionsButton.click();
  await expect(page.getByRole("dialog", { name: "所有功能" }).getByRole("link", { name: "帳號與安全性" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "付款與金流" })).toHaveCount(0);
  await gotoLocalPath(page, `/merchant/stalls/${stallId}/line`);
  await expect(page.getByRole("heading", { name: "LINE 訂單通知" })).toBeVisible();
  await expect(page.getByText(/整合狀態：(?:未啟用|設定已儲存，尚未驗證實際收訊。|需要檢查)/)).toBeVisible();
});

test("mobile editor traps focus and restores trigger while rotation preserves unsaved catalog selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, "/merchant/aming-chicken");
  const catalogTrigger = page.getByRole("button", { name: "攤位商品設定", exact: true });
  await catalogTrigger.click();
  const dialog = page.getByRole("dialog", { name: "攤位商品設定" });
  await expect(dialog).toBeVisible();
  const product = dialog.locator("[data-stall-product-list] h3").first();
  const name = (await product.innerText()).trim();
  const selected = page.getByRole("checkbox", { name: `選取 ${name}` });
  await selected.check();
  await expect(selected).toBeChecked();
  const outside = page.getByRole("link", { name: "攤點通" });
  await outside.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(selected).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selected).toBeChecked();
  const settings = page.getByTestId("stall-product-settings-trigger").first();
  await settings.click();
  const child = page.getByTestId("stall-product-settings-dialog");
  await expect(child).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(child).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(catalogTrigger).toBeFocused();
});

test("switching to an authorized stall clears the prior catalog draft and hint", async ({ page }) => {
  const activeStalls = await prisma.stall.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, slug: true, stallProducts: { take: 1, select: { product: { select: { name: true } } } } },
  });
  const other = activeStalls.find((stall) => stall.id !== stallId
    && stall.stallProducts.length > 0
    && activeStalls.filter((candidate) => candidate.name === stall.name).length === 1);
  expect(other, "The owned lab needs another uniquely named authorized active stall with a product").toBeDefined();
  const before = await prisma.stallProduct.findMany({ where: { stallId: other!.id }, orderBy: { id: "asc" },
    select: { id: true, isEnabled: true, isSoldOut: true, stockRemaining: true, stockVersion: true } });

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, "/merchant/aming-chicken");
  const trigger = page.getByRole("button", { name: "攤位商品設定", exact: true });
  await trigger.click();
  const draft = page.getByRole("checkbox", { name: `選取 ${fixtureName}` });
  await draft.check();
  await expect(draft).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "複製連結", exact: true }).click();
  const priorHint = page.getByRole("status").filter({ hasText: /統一公開連結已複製|請在提示視窗中複製公開菜單連結/ });
  await expect(priorHint).toBeVisible();
  const picker = page.getByRole("button", { name: "選擇攤位：阿明鹽酥雞", exact: true });
  await picker.click();
  await page.getByRole("dialog", { name: "選擇攤位" }).getByRole("button", { name: other!.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/merchant/${other!.slug}$`));
  await expect(page.getByRole("heading", { name: other!.name, exact: true })).toBeVisible();
  await expect(priorHint).toHaveCount(0);
  await page.getByRole("button", { name: "攤位商品設定", exact: true }).click();
  const otherCatalog = page.getByRole("dialog", { name: "攤位商品設定" });
  await expect(otherCatalog.getByRole("heading", { name: other!.stallProducts[0].product.name, exact: true }).first()).toBeVisible();
  await expect(otherCatalog.getByRole("checkbox", { name: `選取 ${fixtureName}` })).toHaveCount(0);
  await expect(otherCatalog.getByRole("checkbox", { name: `選取 ${other!.stallProducts[0].product.name}` }).first()).not.toBeChecked();
  expect(await prisma.stallProduct.findMany({ where: { stallId: other!.id }, orderBy: { id: "asc" },
    select: { id: true, isEnabled: true, isSoldOut: true, stockRemaining: true, stockVersion: true } })).toEqual(before);
});

test("report filters and export preserve scope", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLocalPath(page, `/merchant/reports/overview?organizationId=${organizationId}&stallId=${stallId}`);
  const form = page.locator("form").filter({ has: page.getByTestId("report-date-action-row") });
  await form.getByRole("button", { name: "自訂" }).click();
  await form.getByRole("textbox", { name: "開始日期" }).fill("2026-09-01");
  await form.getByRole("textbox", { name: "結束日期" }).fill("2026-09-30");
  const exportRequest = page.waitForRequest(request => request.url().endsWith("/api/merchant/reports/export") && request.method() === "POST");
  const exportResponse = page.waitForResponse(response => response.url().endsWith("/api/merchant/reports/export") && response.request().method() === "POST");
  await form.getByRole("button", { name: "匯出 CSV" }).click();
  const confirmation = page.getByRole("dialog", { name: "匯出 CSV" });
  await expect(confirmation).toContainText("2026-09-01 – 2026-09-30");
  const download = page.waitForEvent("download");
  await confirmation.getByRole("button", { name: "匯出 CSV" }).click();
  const body = exportRequest.then(request => request.postDataJSON() as { stallIds: string[]; dateFrom: string; dateTo: string });
  expect((await body).stallIds).toEqual([stallId]);
  expect((await body).dateFrom).toBe("2026-09-01");
  expect((await body).dateTo).toBe("2026-09-30");
  const response = await exportResponse;
  expect(response.status()).toBe(200);
  const file = await download;
  expect(file.suggestedFilename()).toBe("stallorder-report-2026-09-01-2026-09-30.csv");
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain('"營業日期","攤位代碼"');
  const exportedCodes = [...csv.matchAll(/^"\d{4}-\d{2}-\d{2}","([^"]+)",/gm)].map((match) => match[1]);
  expect(exportedCodes.length).toBeGreaterThan(0);
  expect([...new Set(exportedCodes)]).toEqual(["AMING-01"]);
  await form.getByRole("button", { name: "套用篩選" }).click();
  await expect(page).toHaveURL(/dateFrom=2026-09-01.*dateTo=2026-09-30/);
  await expect.poll(() => new URL(page.url()).searchParams.getAll("stallId")).toEqual([stallId]);
  await expect(page.getByTestId("report-overview").first()).toBeVisible();
  await expect(page.getByTestId("report-definitions").first()).toContainText("資料範圍與計算方式");
  await gotoLocalPath(page, `/merchant/reports/overview?organizationId=${organizationId}`);
  await page.getByTestId("report-date-action-row").first().getByRole("button", { name: "本週" }).click();
  await page.getByTestId("report-filter-actions").first().getByRole("button", { name: "套用篩選" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("stallId")).toEqual([]);
});

test("sold-out scope survives refresh and rejects stale customer cart", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const customer = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_APP_URL });
  try {
    const deviceId = randomUUID();
    const headers = () => ({
      origin: process.env.PLAYWRIGHT_APP_URL!,
      "x-stallorder-protocol-version": "1",
      "x-stallorder-operation-id": randomUUID(),
    });
    const sessionResponse = await customer.request.post("/api/public/order-session", {
      headers: headers(), data: { qrToken: fixtureQrToken, deviceId, orderingMode: "DEFAULT", sessionRequestId: randomUUID() },
    });
    expect(sessionResponse.status()).toBe(201);
    const session = await sessionResponse.json() as { orderSessionToken: string; products: Array<{ id: string }> };
    expect(session.products.some(product => product.id === fixtureProductId)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLocalPath(page, "/merchant/aming-chicken");
    await page.getByRole("button", { name: "攤位商品設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "攤位商品設定" });
    await dialog.getByRole("button", { name: `${fixtureName}：供應中，設定供應狀態` }).click();
    const availability = page.getByRole("dialog", { name: "設定供應狀態" });
    await availability.getByRole("button", { name: /^今日售完/ }).click();
    const save = page.waitForResponse(response => response.url().endsWith(`/api/merchant/stalls/${stallId}/products`) && response.request().method() === "PATCH");
    await availability.getByRole("button", { name: "確認今日售完", exact: true }).click();
    expect((await save).status()).toBe(200);
    await page.reload();
    await page.getByRole("button", { name: "攤位商品設定", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "攤位商品設定" }).getByRole("button", { name: `${fixtureName}：暫停供應，設定供應狀態` })).toBeVisible();

    const staleOrder = await customer.request.post("/api/public/orders", { headers: headers(), data: {
      qrToken: fixtureQrToken, deviceId, orderingMode: "DEFAULT", orderSessionToken: session.orderSessionToken,
      clientOrderId: randomUUID(), idempotencyKey: randomUUID(), turnstileIdempotencyKey: randomUUID(),
      turnstileToken: "XXXX.DUMMY.TOKEN.XXXX", customerName: "B1 local stale cart", customerPhone: "0912345678",
      waitAcknowledged: true, scheduledPickupAt: null, items: [{ productId: fixtureProductId, quantity: 1 }],
    } });
    const staleBody = await staleOrder.json() as { code?: string };
    expect(staleOrder.status(), staleBody.code).toBe(400);
    expect(staleBody.code).toBe("PRODUCT_UNAVAILABLE");
  } finally {
    await customer.close();
  }
});

test("pure Staff cannot mutate Merchant availability or stall operations", async ({ page }) => {
  const staffFixture = await prisma.profile.findUniqueOrThrow({
    where: { email: "staff@stallorder.test" },
    select: { id: true, platformRole: true,
      organizationMemberships: { where: { organizationId, isActive: true }, select: { role: true } },
      stallMemberships: { where: { stallId, isActive: true }, select: { role: true } },
    },
  });
  expect(staffFixture.platformRole).toBeNull();
  expect(staffFixture.organizationMemberships).toEqual([]);
  expect(staffFixture.stallMemberships.map((membership) => membership.role)).toEqual(["STAFF"]);
  const stallBefore = await prisma.stall.findUniqueOrThrow({ where: { id: stallId },
    select: { businessStatus: true, orderingEnabled: true, isActive: true, updatedAt: true } });
  await page.context().clearCookies();
  await loginLocalTestAccount(page, "staff@stallorder.test", password);
  await gotoLocalPath(page, "/staff/aming-chicken");
  await expect(page.getByTestId("merchant-function-navigation")).toHaveCount(0);
  const identity = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
    return { status: response.status, body: await response.json() as { user?: { id?: string; email?: string } } };
  });
  expect(identity.status).toBe(200);
  expect(identity.body.user?.email).toBe("staff@stallorder.test");
  expect(identity.body.user?.id).toBe(staffFixture.id);
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === "stallorder_csrf")?.value;
  expect(csrf).toBeTruthy();
  const denied = await page.evaluate(async ({ stallId, fixtureProductId, csrf }) => {
    const response = await fetch(`/api/merchant/stalls/${stallId}/products`, {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ operation: "BULK_AVAILABILITY", productIds: [fixtureProductId], mode: "PERMANENT" }),
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  }, { stallId, fixtureProductId, csrf: csrf! });
  expect(denied.status, denied.body.error).toBe(403);
  expect(denied.body.error).toBe("您的角色沒有執行此操作的權限。");

  const stallDenied = await page.evaluate(async ({ stallId, csrf, current }) => {
    const response = await fetch(`/api/merchant/stalls/${stallId}`, {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ operation: "UPDATE_OPERATIONS", businessStatus: current.businessStatus,
        orderingEnabled: current.orderingEnabled, isActive: current.isActive }),
    });
    return { status: response.status, requestId: response.headers.get("x-request-id"),
      body: await response.json() as { error?: string } };
  }, { stallId, csrf: csrf!, current: stallBefore });
  expect(stallDenied.status).toBe(403);
  expect(stallDenied.body.error).toBe("您的角色沒有執行此操作的權限。");
  expect(stallDenied.requestId).toMatch(/^[0-9a-f-]{36}$/);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { requestId: stallDenied.requestId! },
    select: { action: true, outcome: true, actorProfileId: true, organizationId: true, stallId: true, metadata: true } });
  expect(audit).toMatchObject({ action: "AUTHORIZATION_DENIED", outcome: "DENIED",
    actorProfileId: staffFixture.id, organizationId, stallId });
  expect(JSON.parse(audit.metadata ?? "{}")).toMatchObject({ permission: "MANAGE_STALL", role: "STAFF" });
  expect(await prisma.stall.findUniqueOrThrow({ where: { id: stallId },
    select: { businessStatus: true, orderingEnabled: true, isActive: true, updatedAt: true } })).toEqual(stallBefore);
});

test("CSV import preview exposes row errors and reachable submit on phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await gotoLocalPath(page, `/merchant/catalog?organizationId=${organizationId}`);
  const blanks = ",,,,,,,,,,";
  const csv = `${catalogCsvHeaders.join(",")}\n,炸物,,B1 匯入有效商品,,95,,1,true,AMING-01${blanks},true,true\n,炸物,,B1 匯入錯誤商品,,=100,,2,true,AMING-01${blanks},true,true`;
  await page.getByLabel("匯入 CSV").setInputFiles({ name: "b1-preview.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const preview = page.getByRole("dialog", { name: "CSV 匯入預覽" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("B1 匯入有效商品");
  await expect(preview.getByRole("list", { name: "錯誤資料" })).toContainText("CSV 第 3 列");
  const submit = preview.getByRole("button", { name: "套用 1 筆有效資料" });
  await expect(submit).toBeEnabled();
  await preview.getByTestId("catalog-editor-scroll-region").evaluate(element => { element.scrollTop = 0; });
  const actionBounds = await preview.getByTestId("catalog-import-actions").boundingBox();
  const dialogBounds = await preview.boundingBox();
  expect(actionBounds).not.toBeNull();
  expect(dialogBounds).not.toBeNull();
  expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(dialogBounds!.y + dialogBounds!.height + 1);
  await preview.getByRole("button", { name: "取消" }).click();
  await expect(preview).toBeHidden();
});
