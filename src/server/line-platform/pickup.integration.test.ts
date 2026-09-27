import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import { prisma } from "@/lib/prisma";
import { encryptPlatformValue } from "./crypto";
import { handlePickupStaffCommand } from "./pickup-http";
import { GET as pickupCapability } from "@/app/api/line-platform/pickup/[stallSlug]/capability/route";
import {
  ensurePickupMediaForOrder, previewPlatformPickup, redeemPlatformPickup, renderPickupMedia,
  managePlatformPickup, getPlatformPickupManagement,
} from "./pickup-service";

// Explicit opt-in: this suite never falls back to DATABASE_URL or a linked database.
const testUrl = process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55722"
    || url.pathname !== "/stallorder_line_miniapp_20260926") throw new Error("PICKUP_TEST_DATABASE_REJECTED");
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const organizationId = "11111111-1111-4111-8111-111111111111";
const profileId = randomUUID();
const actorId = randomUUID();
const stallId = randomUUID();
const otherStallId = randomUUID();
const subjectHash = digest(randomUUID());
const staffSession = randomUUID();
const staffCsrf = randomUUID();
const staffDevice = randomUUID();
function staffRequest(operation: string, body?: unknown) {
  return new Request(`https://pickup.local.test/api/line-platform/pickup/pickup-test-${stallId}/${operation}`, {
    method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin: "https://pickup.local.test",
      "sec-fetch-site": "same-origin", "x-csrf-token": staffCsrf,
      cookie: `stallorder_session=${staffSession}; stallorder_csrf=${staffCsrf}; stallorder_auth_device=${staffDevice}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe.skipIf(!testUrl)("platform pickup real database lifecycle", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testUrl!);
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("LINE_PLATFORM_ENABLED", "true"); vi.stubEnv("LINE_PLATFORM_ENVIRONMENT", "local");
    vi.stubEnv("LINE_PLATFORM_PICKUP_ENABLED", "true");
    vi.stubEnv("APP_BASE_URL", "https://pickup.local.test");
    vi.stubEnv("LINE_PLATFORM_DATA_KEY", Buffer.alloc(32, 47).toString("base64"));
    vi.stubEnv("LINE_PLATFORM_BINDING_JSON", JSON.stringify({ environment: "local", providerId: "1234567",
      channelId: "1234568", liffId: "1234568-fixture", internalChannel: "developing", endpointUrl: "https://pickup.local.test/mini",
      oaDestination: `U${"a".repeat(32)}`, oaChannelId: "1234569", oaAccessTokenReference: randomUUID(),
      oaSecretReference: randomUUID(), termsVersion: "test-v1" }));
    const db = await prisma.$queryRaw<Array<{ name: string }>>`select current_database() as name`;
    expect(db[0].name).toBe("stallorder_line_miniapp_20260926");
    await prisma.profile.createMany({ data: [{ id: profileId, displayName: "Pickup synthetic customer" },
      { id: actorId, displayName: "Pickup synthetic staff" }] });
    const identity = await prisma.authIdentity.create({ data: { profileId, provider: "LINE", providerSubject: `pickup-test-${randomUUID()}` } });
    await prisma.$executeRaw`insert into public.line_platform_members
      (profile_id, auth_identity_id, environment, provider_id, subject_hash, subject_ciphertext, terms_version, terms_accepted_at, terms_source)
      values (${profileId}::uuid, ${identity.id}::uuid, 'local', '1234567', ${subjectHash},
        ${encryptPlatformValue("synthetic-pickup-subject")}, 'test-v1', now(), 'MINI_APP')`;
    for (const id of [stallId, otherStallId]) {
      const marker = id.replaceAll("-", "").slice(0, 8);
      await prisma.stall.create({ data: { id, organizationId, name: "Synthetic pickup test", slug: `pickup-test-${id}`,
        code: `PT${marker}`, address: "Synthetic test location", location: "Synthetic test location" } });
      await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id, environment, enabled, cutover_at)
        values (${id}::uuid, 'local', true, now() - interval '1 day')`;
    }
    await prisma.stallMembership.create({ data: { organizationId, stallId, profileId: actorId, role: "STAFF" } });
    await prisma.authSession.create({ data: { profileId: actorId, tokenHash: digest(staffSession),
      csrfTokenHash: digest(staffCsrf), deviceId: staffDevice, profileSessionVersion: 1,
      expiresAt: new Date(Date.now() + 60 * 60_000) } });
  });
  afterAll(async () => { if (testUrl) await prisma.$disconnect(); vi.unstubAllEnvs(); });

  async function fixture(options: { paid?: boolean; ready?: boolean; expired?: boolean;
    isTest?: boolean; origin?: "TEST" | "SYSTEM_CANARY"; required?: boolean } = {}) {
    const id = randomUUID();
    const createdAt = new Date(Date.now() - (options.expired ? 4 * 60 * 60_000 : 0));
    await prisma.order.create({ data: { id, organizationId, stallId, orderNo: `P-${id.slice(0, 16)}`,
      trackingTokenHash: digest(randomUUID()), idempotencyKey: randomUUID(), customerName: "Synthetic pickup test",
      deviceHash: digest(randomUUID()), source: "QR_MENU", fulfillmentType: "TAKEOUT",
      isTest: options.isTest ?? false, origin: options.origin ?? "ONLINE_QR",
      status: options.ready === false ? "PREPARING" : "READY", paymentStatus: options.paid === false ? "UNPAID" : "PAID",
      subtotal: 100, total: 100, createdAt, confirmationExpiresAt: new Date(Date.now() + 60 * 60_000),
      pickupCodeHash: digest("481"), pickupCodeDisplay: "481", pickupCodeLength: 3,
      items: { create: { organizationId, stallId, name: "Synthetic meal", baseUnitPrice: 100, unitPrice: 100, quantity: 1,
        status: options.ready === false ? "PREPARING" : "READY" } } } });
    await prisma.$executeRaw`insert into public.line_platform_order_owners(order_id, profile_id, environment, provider_id, subject_hash, pickup_required)
      values (${id}::uuid, ${profileId}::uuid, 'local', '1234567', ${subjectHash}, ${options.required ?? true})`;
    return id;
  }
  async function credential(orderId: string) {
    const media = await ensurePickupMediaForOrder(orderId, "local");
    expect(media).not.toBeNull();
    const mediaToken = new URL(media!.imageUrl).pathname.split("/").at(-1)!;
    const png = await renderPickupMedia(mediaToken);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const token = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
    expect(token).toMatch(/^qidaigo:pickup:v1:/);
    return { token: token!, mediaToken, version: media!.version };
  }
  async function ledger(orderId: string) {
    const [row] = await prisma.$queryRaw<Array<{ handoffs: number; billable: number }>>`
      select (select count(*)::integer from public.order_events where order_id = ${orderId}::uuid
        and event_type = 'LINE_PLATFORM_PICKED_UP') as handoffs,
      (select count(*)::integer from public.usage_events where reference_id = ${orderId}
        and event_type = 'BILLABLE_ORDER_COMPLETED') as billable
    `;
    return row;
  }

  it("preserves real staff HTTP handoff after pilot and new-pickup shutdown before the first QR exists", async () => {
    const orderId = await fixture();
    const legacyId = await fixture({ required: false });
    const slug = `pickup-test-${stallId}`;
    const context = { params: Promise.resolve({ stallSlug: slug }) };
    expect((await getPlatformPickupManagement(stallId, orderId)).version).toBe(0);
    await prisma.$executeRaw`update public.line_platform_stalls set enabled=false where stall_id=${stallId}::uuid`;
    vi.stubEnv("LINE_PLATFORM_PICKUP_ENABLED", "false");
    try {
      expect(await (await pickupCapability(staffRequest("capability"), context)).json()).toEqual({ enabled: true });
      await expect(prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } })).rejects.toThrow();
      expect(await ensurePickupMediaForOrder(legacyId, "local")).toBeNull();
      const unmanaged = await handlePickupStaffCommand(staffRequest("manage", { orderId: legacyId,
        operation: "REISSUE", expectedVersion: 0, reason: "Do not upgrade historical orders" }), slug, "manage");
      expect(unmanaged.status).toBe(404);
      const issueResponse = await handlePickupStaffCommand(staffRequest("manage", { orderId,
        operation: "REISSUE", expectedVersion: 0, reason: "Customer device unavailable after pilot shutdown" }), slug, "manage");
      expect(issueResponse.status).toBe(200);
      expect(await issueResponse.json()).toMatchObject({ version: 1 });
      const qr = await credential(orderId);
      expect(qr.version).toBe(1);
      const manual = { kind: "MANUAL" as const, orderId, code: "481", reason: "DEVICE_LOST" as const, confirmedCustomerDetails: true as const };
      const previewResponse = await handlePickupStaffCommand(staffRequest("preview", manual), slug, "preview");
      expect(previewResponse.status).toBe(200);
      expect(await previewResponse.json()).toMatchObject({ canRedeem: true });
      expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
      const command = { credential: manual, expectedVersion: 1, idempotencyKey: randomUUID(), confirmedHandoff: true };
      const noCsrf = staffRequest("redeem", command); noCsrf.headers.delete("x-csrf-token");
      expect((await handlePickupStaffCommand(noCsrf, slug, "redeem")).status).toBe(403);
      vi.stubEnv("LINE_PLATFORM_ENABLED", "false");
      expect((await handlePickupStaffCommand(staffRequest("redeem", command), slug, "redeem")).status).toBe(503);
      vi.stubEnv("LINE_PLATFORM_ENABLED", "true");
      expect((await handlePickupStaffCommand(staffRequest("redeem", command), slug, "redeem")).status).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("COMPLETED");
      expect(await ledger(orderId)).toEqual({ handoffs: 1, billable: 1 });
      expect(await (await pickupCapability(staffRequest("capability"), context)).json()).toEqual({ enabled: false });
      await prisma.order.update({ where: { id: legacyId }, data: { status: "COMPLETED" } });
      expect(await ledger(legacyId)).toEqual({ handoffs: 0, billable: 1 });
    } finally {
      vi.stubEnv("LINE_PLATFORM_ENABLED", "true"); vi.stubEnv("LINE_PLATFORM_PICKUP_ENABLED", "true");
      await prisma.$executeRaw`update public.line_platform_stalls set enabled=true where stall_id=${stallId}::uuid`;
    }
  });
  it("previews without completing, and concurrent confirmed handoffs produce one completion and one bill", async () => {
    const orderId = await fixture();
    await expect(prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } })).rejects.toThrow();
    const qr = await credential(orderId);
    expect(await ensurePickupMediaForOrder(orderId, "local")).toMatchObject({ version: qr.version });
    const input = { kind: "QR" as const, token: qr.token };
    expect(await previewPlatformPickup(stallId, input)).toMatchObject({ canRedeem: true, pickedUpAt: null });
    expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
    await expect(prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } })).rejects.toThrow();
    const command = { credential: input, expectedVersion: qr.version, idempotencyKey: randomUUID(), confirmedHandoff: true as const };
    const results = await Promise.all([redeemPlatformPickup(stallId, actorId, command), redeemPlatformPickup(stallId, actorId, command)]);
    expect(results.map((r) => r.alreadyRedeemed).sort()).toEqual([false, true]);
    expect(await ledger(orderId)).toEqual({ handoffs: 1, billable: 1 });
    expect(await previewPlatformPickup(stallId, input)).toMatchObject({ status: "COMPLETED", canRedeem: false });
    expect(await ensurePickupMediaForOrder(orderId, "local")).toBeNull();
    await expect(renderPickupMedia(qr.mediaToken)).rejects.toMatchObject({ code: "PICKUP_MEDIA_NOT_FOUND" });
  });
  it("denies another stall, media-token substitution and unconfirmed delivery", async () => {
    const orderId = await fixture(); const qr = await credential(orderId);
    await expect(previewPlatformPickup(otherStallId, { kind: "QR", token: qr.token })).rejects.toMatchObject({ code: "PICKUP_NOT_FOUND" });
    await expect(previewPlatformPickup(stallId, { kind: "QR", token: qr.mediaToken })).rejects.toThrow();
    await expect(redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: qr.token },
      expectedVersion: 1, idempotencyKey: randomUUID(), confirmedHandoff: false as unknown as true })).rejects.toThrow();
    expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
  });
  it("does not convert an unpaid QR or unfinished meal into a delivery", async () => {
    for (const options of [{ paid: false }, { ready: false }]) {
      const orderId = await fixture(options); const qr = await credential(orderId);
      expect(await previewPlatformPickup(stallId, { kind: "QR", token: qr.token })).toMatchObject({ canRedeem: false });
      await expect(redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: qr.token }, expectedVersion: 1,
        idempotencyKey: randomUUID(), confirmedHandoff: true })).rejects.toBeInstanceOf(Error);
      expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
    }
  });
  it("revokes old QR on a schedule change, supports reasoned reissue, and uses the same manual handoff command", async () => {
    const orderId = await fixture(); const old = await credential(orderId);
    await prisma.order.update({ where: { id: orderId }, data: { fulfillmentTimeVersion: 1, fulfillmentTimeState: "CONFIRMED",
      committedFulfillmentAt: new Date(Date.now() + 60 * 60_000) } });
    await expect(previewPlatformPickup(stallId, { kind: "QR", token: old.token })).rejects.toMatchObject({ code: "PICKUP_REVOKED" });
    expect(await ensurePickupMediaForOrder(orderId, "local")).toBeNull();
    await managePlatformPickup(stallId, actorId, { orderId, operation: "REISSUE", expectedVersion: 1, reason: "Confirmed delayed pickup" });
    const next = await credential(orderId); expect(next.version).toBe(2); expect(next.token).not.toBe(old.token);
    await expect(renderPickupMedia(old.mediaToken)).rejects.toThrow();
    const manual = { kind: "MANUAL" as const, orderId, code: "481", reason: "CAMERA_UNAVAILABLE" as const, confirmedCustomerDetails: true as const };
    const result = await redeemPlatformPickup(stallId, actorId, { credential: manual, expectedVersion: 2,
      idempotencyKey: randomUUID(), confirmedHandoff: true });
    expect(result.status).toBe("COMPLETED"); expect(await ledger(orderId)).toEqual({ handoffs: 1, billable: 1 });
  });
  it("requires explicit staff extension for an expired initial deadline", async () => {
    const orderId = await fixture({ expired: true });
    expect(await ensurePickupMediaForOrder(orderId, "local")).toBeNull();
    expect(await getPlatformPickupManagement(stallId, orderId)).toMatchObject({ version: 0 });
    await managePlatformPickup(stallId, actorId, { orderId, operation: "REISSUE", expectedVersion: 0,
      reason: "Customer confirmed delayed arrival", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    expect(await ensurePickupMediaForOrder(orderId, "local")).not.toBeNull();
  });
  it("rejects a cancelled order without adding a handoff or bill", async () => {
    const orderId = await fixture(); const qr = await credential(orderId);
    await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    await expect(redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: qr.token }, expectedVersion: 1,
      idempotencyKey: randomUUID(), confirmedHandoff: true })).rejects.toMatchObject({ code: "PICKUP_ORDER_UNAVAILABLE" });
    expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
  });
  it("serializes cancellation against handoff with a single final outcome", async () => {
    const orderId = await fixture(); const qr = await credential(orderId);
    const [handoff, cancellation] = await Promise.allSettled([
      redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: qr.token }, expectedVersion: 1,
        idempotencyKey: randomUUID(), confirmedHandoff: true }),
      prisma.order.updateMany({ where: { id: orderId, status: "READY" }, data: { status: "CANCELLED" } }),
    ]);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    if (handoff.status === "fulfilled") {
      expect(order.status).toBe("COMPLETED");
      expect(cancellation).toMatchObject({ status: "fulfilled", value: { count: 0 } });
      expect(await ledger(orderId)).toEqual({ handoffs: 1, billable: 1 });
    } else {
      expect(order.status).toBe("CANCELLED");
      expect(cancellation).toMatchObject({ status: "fulfilled", value: { count: 1 } });
      expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
    }
  });
  it("rejects an idempotency key reused for another order", async () => {
    const firstId = await fixture(); const secondId = await fixture();
    const first = await credential(firstId); const second = await credential(secondId);
    const key = randomUUID();
    await redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: first.token }, expectedVersion: 1,
      idempotencyKey: key, confirmedHandoff: true });
    await expect(redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: second.token }, expectedVersion: 1,
      idempotencyKey: key, confirmedHandoff: true })).rejects.toMatchObject({ code: "PICKUP_IDEMPOTENCY_CONFLICT" });
    expect(await ledger(secondId)).toEqual({ handoffs: 0, billable: 0 });
  });
  it("denies direct credential reads and writes to authenticated browser roles", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRaw`set local role authenticated`;
      await tx.$queryRaw`select token_ciphertext from public.line_platform_pickup_credentials limit 1`;
    })).rejects.toThrow();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRaw`set local role authenticated`;
      await tx.$executeRaw`update public.line_platform_pickup_credentials set revoked_at = now() where false`;
    })).rejects.toThrow();
    const [rls] = await prisma.$queryRaw<Array<{ enabled: boolean; forced: boolean }>>`
      select relrowsecurity as enabled, relforcerowsecurity as forced from pg_class
      where oid = 'public.line_platform_pickup_credentials'::regclass
    `;
    expect(rls).toEqual({ enabled: true, forced: true });
  });
  it("keeps the existing test and canary billing exclusions after real handoff", async () => {
    for (const options of [{ isTest: true }, { origin: "TEST" as const }, { origin: "SYSTEM_CANARY" as const }]) {
      const orderId = await fixture(options); const qr = await credential(orderId);
      await redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: qr.token }, expectedVersion: 1,
        idempotencyKey: randomUUID(), confirmedHandoff: true });
      expect(await ledger(orderId)).toEqual({ handoffs: 1, billable: 0 });
    }
  });
  it("keeps orders created before pickup activation on their original completion path", async () => {
    const orderId = await fixture({ required: false });
    expect(await ensurePickupMediaForOrder(orderId, "local")).toBeNull();
    await prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
    expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 1 });
  });
  it("keeps unknown refunds pending instead of delivering an apparently paid order", async () => {
    const orderId = await fixture(); const qr = await credential(orderId);
    const connection = await prisma.paymentProviderConnection.create({ data: {
      organizationId, stallId, provider: "LINE_PAY", connectionMode: "DIRECT", environment: "MOCK", status: "DISABLED",
    } });
    const transaction = await prisma.paymentProviderTransaction.create({ data: {
      organizationId, stallId, orderId, providerConnectionId: connection.id, provider: "LINE_PAY",
      merchantOrderId: `pickup-${randomUUID()}`, amount: 100, status: "PAID", idempotencyKeyHash: digest(randomUUID()),
    } });
    await prisma.paymentProviderRefund.create({ data: {
      organizationId, stallId, transactionId: transaction.id, requestedByProfileId: actorId,
      requestedAmount: 100, reason: "Synthetic unknown refund", status: "UNKNOWN", idempotencyKeyHash: digest(randomUUID()),
    } });
    expect(await previewPlatformPickup(stallId, { kind: "QR", token: qr.token })).toMatchObject({ canRedeem: false });
    await expect(redeemPlatformPickup(stallId, actorId, { credential: { kind: "QR", token: qr.token }, expectedVersion: 1,
      idempotencyKey: randomUUID(), confirmedHandoff: true })).rejects.toMatchObject({ code: "PICKUP_NOT_READY" });
    expect(await ledger(orderId)).toEqual({ handoffs: 0, billable: 0 });
  });
});
