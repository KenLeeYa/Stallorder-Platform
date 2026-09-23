import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test.skip(process.env.UI_UX_QA !== "true", "Explicit isolated authorization QA only.");
const db = new PrismaClient();
const stallId = "22222222-2222-4222-8222-222222222222";
test.afterAll(async () => db.$disconnect());

test("administrator revokes and restores a local staff role; an already-open page cannot bypass server authorization", async ({ browser }) => {
  expect(process.env.PLAYWRIGHT_APP_URL).toBe("http://127.0.0.1:3023");
  const database = new URL(process.env.DATABASE_URL!);
  expect(database.hostname).toBe("127.0.0.1");
  expect(database.port).toBe("55722");
  expect(database.pathname).toBe("/postgres");
  const member = await db.stallMembership.findFirstOrThrow({ where: { stallId, role: "STAFF", isActive: true, profile: { email: "staff@stallorder.test" } } });
  const admin = await browser.newContext();
  const staff = await browser.newContext();
  let restored = false;
  let changed = false;
  let headers: Record<string, string> = {};
  const path = `/api/merchant/stalls/${stallId}/memberships/${member.id}`;
  try {
    const adminPage = await admin.newPage();
    await adminPage.goto("/login?next=%2Fadmin%2Fbilling");
    await adminPage.getByTestId("local-qa-login-grid").getByRole("button", { name: "平台管理者", exact: true }).click();
    await adminPage.waitForURL((url) => url.pathname === "/admin/billing");
    headers = { origin: process.env.PLAYWRIGHT_APP_URL!, "x-csrf-token": (await admin.cookies()).find((cookie) => cookie.name === "stallorder_csrf")!.value };
    const staffPage = await staff.newPage();
    await staffPage.goto("/login?next=%2Fstaff%2Faming-chicken");
    await staffPage.getByTestId("local-qa-login-grid").getByRole("button", { name: "店員", exact: true }).click();
    await staffPage.waitForURL((url) => url.pathname === "/staff/aming-chicken");
    const orders = "/api/stalls/aming-chicken/orders";
    expect((await staffPage.request.get(orders)).status()).toBe(200);
    changed = true;
    const response = await admin.request.patch(path, { headers, data: { role: member.role, isActive: false } });
    expect(response.status()).toBe(200);
    await expect.poll(async () => (await staffPage.request.get(orders)).status()).toBe(404);
    await staffPage.reload();
    await expect(staffPage.getByTestId("staff-order-master-detail")).toHaveCount(0);
    expect((await admin.request.patch(path, { headers, data: { role: member.role, isActive: member.isActive } })).status()).toBe(200);
    restored = true;
    await expect.poll(async () => (await staffPage.request.get(orders)).status()).toBe(200);
    await staffPage.goto("/staff/aming-chicken");
    await expect(staffPage.getByTestId("staff-order-mobile-list")).toBeAttached();
    expect(await db.auditLog.count({ where: { entityId: member.id, action: "STALL_ROLE_REVOKED", outcome: "SUCCESS" } })).toBeGreaterThan(0);
  } finally {
    if (changed && !restored) {
      try {
        const response = await admin.request.patch(path, { headers, data: { role: member.role, isActive: member.isActive } });
        restored = response.status() === 200;
      } catch { /* A timed-out request may have committed; restore only this local fixture below. */ }
      if (!restored) await db.stallMembership.update({ where: { id: member.id }, data: { role: member.role, isActive: member.isActive } });
    }
    await admin.close();
    await staff.close();
  }
});
