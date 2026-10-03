import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginLocalTestAccount } from "./local-navigation";

const db = new PrismaClient();
const org = "11111111-1111-4111-8111-111111111111";
const stall = "22222222-2222-4222-8222-222222222222";
const marker = `edit-regression-${randomUUID()}`;
const email = `${marker}@stallorder.test`;
let actorId = "", productId = "", categoryId = "";
const orderIds: string[] = [];

test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || target.pathname !== "/postgres") throw new Error("STAFF_EDIT_LOCAL_DATABASE_REQUIRED");
  const parent = await db.stall.findUniqueOrThrow({ where: { id: stall } });
  expect(parent.organizationId).toBe(org); expect(parent.slug).toBe("aming-chicken");
  const staff = await db.profile.findUniqueOrThrow({ where: { email: "staff@stallorder.test" } });
  if (!staff.passwordHash) throw new Error("STAFF_EDIT_TEST_CREDENTIAL_MISSING");
  actorId = (await db.profile.create({ data: {
    email, displayName: marker, passwordHash: staff.passwordHash, authMigrationRequired: false,
    stallMemberships: { create: { organizationId: org, stallId: stall, role: "STAFF" } },
  } })).id;
  categoryId = (await db.productCategory.create({ data: { organizationId: org, name: marker } })).id;
  productId = (await db.product.create({ data: {
    organizationId: org, categoryId, name: marker, description: "Synthetic local edit regression", defaultPrice: 100,
    stallProducts: { create: { organizationId: org, stallId: stall, isEnabled: true, stockRemaining: 100 } },
  } })).id;
});

test.afterAll(async () => {
  try {
    // Preserve immutable audit references and remove owned fixtures from active queues.
    if (orderIds.length) await db.order.updateMany({ where: { id: { in: orderIds }, organizationId: org, stallId: stall }, data: { status: "CANCELLED" } });
    if (productId) {
      await db.stallProduct.updateMany({ where: { productId, organizationId: org, stallId: stall }, data: { isEnabled: false } });
      await db.product.update({ where: { id: productId }, data: { isActive: false } });
    }
    if (categoryId) await db.productCategory.update({ where: { id: categoryId }, data: { isActive: false } });
    if (actorId) {
      await db.authSession.updateMany({ where: { profileId: actorId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "E2E_FIXTURE_CLEANUP" } });
      await db.stallMembership.updateMany({ where: { profileId: actorId, organizationId: org, stallId: stall }, data: { isActive: false } });
      await db.profile.update({ where: { id: actorId }, data: { isActive: false } });
    }
  } finally { await db.$disconnect(); }
});

async function fixture() {
  const id = randomUUID();
  const order = await db.order.create({ data: {
    id, organizationId: org, stallId: stall, orderNo: `EDIT-${id.slice(0, 8)}`,
    trackingTokenHash: createHash("sha256").update(id).digest("hex"), idempotencyKey: randomUUID(),
    source: "STAFF_POS", origin: "ONLINE_STAFF", isTest: true, customerName: marker,
    deviceHash: createHash("sha256").update(marker).digest("hex"), confirmationExpiresAt: new Date(Date.now() + 3600000),
    status: "CONFIRMED", paymentStatus: "UNPAID", subtotal: 200, total: 200,
    items: { create: { organizationId: org, stallId: stall, productId, sourceLineIndex: 1,
      name: marker, baseUnitPrice: 100, unitPrice: 100, quantity: 2, status: "PENDING" } },
  }, include: { items: true } });
  orderIds.push(id); return order;
}
async function snapshot(id: string) {
  return {
    order: await db.order.findUniqueOrThrow({ where: { id }, include: { items: true, events: true, payment: true } }),
    stock: await db.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId: stall, productId } } }),
    tasks: await db.orderProductionTask.findMany({ where: { orderId: id }, orderBy: { id: "asc" } }),
    prints: await db.printJob.findMany({ where: { orderId: id }, orderBy: { id: "asc" } }),
  };
}
async function patch(page: Page, id: string, data: object) {
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === "stallorder_csrf")?.value;
  expect(csrf).toBeTruthy();
  // Chromium accepts Secure cookies on loopback HTTP; APIRequestContext does not.
  const result = await page.evaluate(async ({ id, data, csrf }) => {
    const response = await fetch(`/api/stalls/aming-chicken/orders/${id}/content`, {
      method: "PATCH", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf! },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }, { id, data, csrf });
  return { status: () => result.status, json: async () => result.body };
}
async function login(page: Page) {
  await loginLocalTestAccount(page, email, "StallOrderDemo!2026", "/staff/aming-chicken");
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  expect(me.status).toBe(200);
  expect(me.body.user.id).toBe(actorId);
}

test("persisted staff edit succeeds once and replay creates no extra stock, tasks or print jobs", async ({ page }) => {
  await login(page); const order = await fixture(); const before = await snapshot(order.id);
  const command = { changeId: randomUUID(), expectedUpdatedAt: order.updatedAt.toISOString(),
    items: [{ kind: "EXISTING", itemId: order.items[0]!.id, quantity: 3 }] };
  const response = await patch(page, order.id, command); expect(response.status()).toBe(200);
  const after = await snapshot(order.id);
  expect(after.order).toMatchObject({ status: "CONFIRMED", paymentStatus: "UNPAID", subtotal: 300, total: 300 });
  expect(after.order.items).toHaveLength(1); expect(after.order.items[0]).toMatchObject({ id: order.items[0]!.id, quantity: 3 });
  expect(after.stock.stockRemaining).toBe(before.stock.stockRemaining! - 1);
  expect(after.order.events.filter(event => event.eventType === "STAFF_ORDER_ITEMS_EDITED")).toHaveLength(1);
  expect(after.order.payment).toBeNull();
  expect((await patch(page, order.id, command)).status()).toBe(200);
  expect(await snapshot(order.id)).toEqual(after);
});

for (const locked of ["PAID", "PREPARING"] as const) {
  test(`persisted ${locked} order rejects edits without changing stock, items, events or prints`, async ({ page }) => {
    await login(page); const order = await fixture();
    if (locked === "PAID") await db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
    else await db.orderItem.update({ where: { id: order.items[0]!.id }, data: { status: "PREPARING" } });
    const before = await snapshot(order.id);
    const response = await patch(page, order.id, { changeId: randomUUID(), expectedUpdatedAt: before.order.updatedAt.toISOString(),
      items: [{ kind: "EXISTING", itemId: order.items[0]!.id, quantity: 1 }] });
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe(locked === "PAID" ? "PAYMENT_ALREADY_RECORDED" : "ORDER_ALREADY_STARTED");
    expect(await snapshot(order.id)).toEqual(before);
  });
}

test("real stock constraint rolls back item writes, order totals, events, tasks and print jobs", async ({ page }) => {
  await login(page); const order = await fixture();
  const assignment = await db.stallProduct.findUniqueOrThrow({ where: { stallId_productId: { stallId: stall, productId } } });
  await db.stallProduct.update({ where: { id: assignment.id }, data: { stockRemaining: 0 } });
  try {
    const before = await snapshot(order.id);
    const response = await patch(page, order.id, { changeId: randomUUID(), expectedUpdatedAt: before.order.updatedAt.toISOString(),
      items: [{ kind: "EXISTING", itemId: order.items[0]!.id, quantity: 3 }] });
    expect(response.status()).toBe(409); expect((await response.json()).code).toBe("PRODUCT_STOCK_INSUFFICIENT");
    expect(await snapshot(order.id)).toEqual(before);
  } finally {
    await db.stallProduct.updateMany({ where: { id: assignment.id, stockRemaining: 0 }, data: { stockRemaining: assignment.stockRemaining } });
  }
});

for (const source of ["QR_MENU", "LINE_DELIVERY"] as const) {
  test(`staff adjusts persisted ${source} delivery and records the public amendment`, async ({ page }) => {
    await login(page);
    const seed = await fixture();
    const order = await db.order.update({ where: { id: seed.id }, data: {
      source, fulfillmentType: "DELIVERY", origin: "ONLINE_QR", status: "WAITING_CONFIRMATION",
      customerPhone: "0912345678", deliveryAddress: "本機合成測試地址，請勿外送",
    }, include: { items: true } });
    const before = await snapshot(order.id);
    const customerMessage = `${marker} 缺貨調整：保留一份`;
    const response = await patch(page, order.id, {
      changeId: randomUUID(), expectedUpdatedAt: order.updatedAt.toISOString(),
      items: [{ kind: "EXISTING", itemId: order.items[0]!.id, quantity: 1 }],
      publicAmendment: { reason: "SOLD_OUT_REMOVE", customerMessage },
    });
    expect(response.status()).toBe(200);
    const after = await snapshot(order.id);
    expect(after.order).toMatchObject({ source, fulfillmentType: "DELIVERY", status: "WAITING_CONFIRMATION",
      paymentStatus: "UNPAID", subtotal: 100, total: 100 });
    expect(after.order.items).toHaveLength(1);
    expect(after.order.items[0]).toMatchObject({ id: order.items[0]!.id, quantity: 1 });
    expect(after.stock.stockRemaining).toBe(before.stock.stockRemaining! + 1);
    const amendments = after.order.events.filter(event => event.eventType === "PUBLIC_ORDER_ITEMS_ADJUSTED");
    expect(amendments).toHaveLength(1);
    expect(amendments[0]!.metadataJson).toMatchObject({ reason: "SOLD_OUT_REMOVE", customerMessage });
    expect(after.order.payment).toBeNull();
  });
}
