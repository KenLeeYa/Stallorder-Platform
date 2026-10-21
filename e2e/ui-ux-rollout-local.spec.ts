import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.skip(process.env.UI_UX_QA !== "true", "Explicit local rollout QA; retains one demo stall's UI flag.");
const db = new PrismaClient();
const code = "STAFF_WORKSPACE_REDESIGN_ENABLED";
const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const endpoint = `/api/admin/resilience/feature-flags/${code}`;
test.afterAll(async () => db.$disconnect());

async function login(page: Page, role: string, next: string) {
  await page.goto("/login?next=" + encodeURIComponent(next));
  await page.getByTestId("local-qa-login-grid").getByRole("button", { name: role, exact: true }).click();
  await page.waitForURL((url) => url.pathname === next);
}

test("admin can roll out and roll back the staff queue without changing orders; staff cannot change the flag", async ({ browser, request }) => {
  test.setTimeout(120_000);
  expect(process.env.PLAYWRIGHT_APP_URL).toBe("http://127.0.0.1:3023");
  const database = new URL(process.env.DATABASE_URL!);
  expect([database.hostname, database.port, database.pathname]).toEqual(["127.0.0.1", "55722", "/postgres"]);
  // Configuration fixture only. No schema change, Production registration, or global enable.
  const flag = await db.resilienceFeatureFlag.upsert({ where: { code }, update: {}, create: {
    code, defaultEnabled: false, description: "店員工作台分頁、篩選與摘要；只影響呈現，預設關閉。",
  } });
  expect(flag.defaultEnabled).toBe(false);
  const before = await db.order.findMany({ where: { stallId }, select: { id: true, status: true, paymentStatus: true, total: true }, orderBy: { id: "asc" } });
  const body = { scopeType: "STALL", organizationId, stallId, enabled: false, reason: "UIUX local retained presentation rollout" };
  expect((await request.put(endpoint, { data: body })).status()).toBe(401);
  const admin = await browser.newContext();
  const staff = await browser.newContext();
  try {
    const adminPage = await admin.newPage();
    const staffPage = await staff.newPage();
    await staffPage.setViewportSize({ width: 1280, height: 900 });
    await login(adminPage, "平台管理者", "/admin/billing");
    const headers = { origin: process.env.PLAYWRIGHT_APP_URL!, "x-csrf-token": (await admin.cookies()).find((cookie) => cookie.name === "stallorder_csrf")!.value };
    expect((await admin.request.put(endpoint, { headers, data: body })).status()).toBe(200);
    await login(staffPage, "店員", "/staff/aming-chicken");
    const staffHeaders = { origin: process.env.PLAYWRIGHT_APP_URL!, "x-csrf-token": (await staff.cookies()).find((cookie) => cookie.name === "stallorder_csrf")!.value };
    // Platform administration hides resources from non-admins (authorization.ts).
    expect((await staff.request.put(endpoint, { headers: staffHeaders, data: { ...body, enabled: true } })).status()).toBe(404);
    const list = staffPage.getByTestId("staff-order-list-pane");
    await expect.poll(async () => { await staffPage.reload(); return await list.getByRole("button").count(); }, { timeout: 30_000 }).toBeGreaterThan(5);
    await expect(staffPage.getByTestId("staff-queue-filters")).toHaveCount(0);
    await list.getByRole("button").nth(1).click();
    await expect(list.getByRole("button").nth(1)).toHaveAttribute("aria-current", "true");
    const legacyCount = await list.getByRole("button").count();
    expect((await admin.request.put(endpoint, { headers, data: { ...body, enabled: true } })).status()).toBe(200);
    await expect.poll(async () => { await staffPage.reload(); return await list.getByRole("button").count(); }, { timeout: 30_000 }).toBe(5);
    await expect(staffPage.getByTestId("staff-queue-filters")).toBeVisible();
    expect((await admin.request.put(endpoint, { headers, data: body })).status()).toBe(200);
    await expect.poll(async () => { await staffPage.reload(); return await list.getByRole("button").count(); }, { timeout: 30_000 }).toBe(legacyCount);
    await expect(staffPage.getByTestId("staff-queue-pagination")).toHaveCount(0);
    // Keep just the named local demo stall enabled for the remaining redesign suite and manual review.
    expect((await admin.request.put(endpoint, { headers, data: { ...body, enabled: true } })).status()).toBe(200);
    await expect.poll(async () => { await staffPage.reload(); return await list.getByRole("button").count(); }, { timeout: 30_000 }).toBe(5);
    expect(await db.order.findMany({ where: { stallId }, select: { id: true, status: true, paymentStatus: true, total: true }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await db.auditLog.count({ where: { action: "RESILIENCE_FEATURE_FLAG_CHANGED", outcome: "SUCCESS" } })).toBeGreaterThan(0);
  } finally {
    await admin.close();
    await staff.close();
  }
});
