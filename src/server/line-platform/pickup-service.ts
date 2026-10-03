import "server-only";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptPlatformValue, decryptPlatformValue } from "./crypto";
import { getLinePlatformRuntime } from "./runtime";
import { renderPickupPng } from "./pickup-render";
import {
  createPickupSecrets, pickupDeadline, pickupMediaPattern, pickupLookupSchema, pickupRedeemSchema, pickupManageSchema,
  type PickupLookup, type PickupRedemption,
} from "./pickup-contract";

type Transaction = Prisma.TransactionClient;
type Credential = {
  id: string; order_id: string; organization_id: string; stall_id: string; environment: string;
  version: number; fulfillment_time_version: number; token_hash: string; media_hash: string;
  token_ciphertext: string; media_ciphertext: string; expires_at: Date; media_expires_at: Date;
  revoked_at: Date | null; revoke_reason: string | null; consumed_at: Date | null; idempotency_key: string | null;
  request_hash: string | null;
};
type Order = {
  id: string; organizationId: string; stallId: string; orderNo: string; pickupCode: string | null;
  status: string; paymentStatus: string; fulfillmentType: string; fulfillmentTimeVersion: number; fulfillmentTimeState: string;
  committedFulfillmentAt: Date | null; scheduledPickupAt: Date | null;
  requestedFulfillmentAt: Date | null; quotedReadyAt: Date | null; createdAt: Date; total: number;
};
export type PickupPreview = {
  orderId: string; orderNo: string; pickupCode: string | null; version: number;
  status: string; paymentStatus: string; expiresAt: string; pickedUpAt: string | null;
  canRedeem: boolean; items: Array<{ name: string; quantity: number }>;
};
export class PickupError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const purpose = (orderId: string, environment: string, kind: "token" | "media") =>
  `pickup:${environment}:${orderId}:${kind}`;

export function requirePickupRuntime() {
  const runtime = getLinePlatformRuntime();
  // New-order enrollment is gated at intake. Frozen handoff obligations must remain operable.
  if (!runtime) throw new PickupError("PICKUP_DISABLED", 503);
  return runtime;
}

async function loadOrder(tx: Transaction, orderId: string, environment: string, stallId?: string, lock = false) {
  const rows = await tx.$queryRaw<Order[]>(Prisma.sql`
    select o.id, o.organization_id as "organizationId", o.stall_id as "stallId",
      o.order_no as "orderNo", o.pickup_code_display as "pickupCode", o.status::text,
      o.payment_status::text as "paymentStatus", o.fulfillment_type::text as "fulfillmentType",
      o.fulfillment_time_version as "fulfillmentTimeVersion", o.fulfillment_time_state as "fulfillmentTimeState", o.total,
      o.committed_fulfillment_at as "committedFulfillmentAt", o.scheduled_pickup_at as "scheduledPickupAt",
      o.requested_fulfillment_at as "requestedFulfillmentAt", o.quoted_ready_at as "quotedReadyAt", o.created_at as "createdAt"
    from public.orders o join public.line_platform_order_owners owner on owner.order_id = o.id
    where o.id = ${orderId}::uuid and owner.environment = ${environment}
      and (owner.pickup_required or exists (
        select 1 from public.line_platform_pickup_credentials c where c.order_id = o.id))
      ${stallId ? Prisma.sql`and o.stall_id = ${stallId}::uuid` : Prisma.empty}
    ${lock ? Prisma.sql`for update of o` : Prisma.empty}
  `);
  if (!rows[0] || rows[0].fulfillmentType !== "TAKEOUT") throw new PickupError("PICKUP_NOT_FOUND", 404);
  return rows[0];
}

async function latestCredential(tx: Transaction, orderId: string) {
  const rows = await tx.$queryRaw<Credential[]>`
    select * from public.line_platform_pickup_credentials where order_id = ${orderId}::uuid
    order by version desc limit 1
  `;
  return rows[0] ?? null;
}

async function issue(tx: Transaction, order: Order, environment: string, version: number, expiresAt: Date) {
  const secrets = createPickupSecrets();
  const mediaExpires = new Date(expiresAt.getTime() + 24 * 60 * 60_000);
  const rows = await tx.$queryRaw<Credential[]>`
    insert into public.line_platform_pickup_credentials
      (order_id, organization_id, stall_id, environment, version, fulfillment_time_version,
       token_hash, media_hash, token_ciphertext, media_ciphertext, expires_at, media_expires_at)
    values (${order.id}::uuid, ${order.organizationId}::uuid, ${order.stallId}::uuid,
      ${environment}, ${version}, ${order.fulfillmentTimeVersion}, ${hash(secrets.token)},
      ${hash(secrets.mediaToken)}, ${encryptPlatformValue(secrets.token, purpose(order.id, environment, "token"))},
      ${encryptPlatformValue(secrets.mediaToken, purpose(order.id, environment, "media"))}, ${expiresAt}, ${mediaExpires})
    returning *
  `;
  return rows[0];
}

function canIssue(order: Order) {
  return !["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status) && order.paymentStatus !== "REFUNDED";
}

export async function ensurePickupMediaForOrder(orderId: string, environment: string) {
  const runtime = getLinePlatformRuntime();
  if (!runtime || runtime.environment !== environment) return null;
  const origin = new URL(runtime.endpointUrl).origin;
  if (!origin.startsWith("https://") && runtime.environment !== "local") return null;
  try {
    const credential = await prisma.$transaction(async (tx) => {
      const order = await loadOrder(tx, orderId, environment, undefined, true);
      if (!canIssue(order)) return null;
      const existing = await latestCredential(tx, orderId);
      const now = new Date();
      const expiresAt = pickupDeadline(order, Number(process.env.PICKUP_TOKEN_GRACE_MINUTES ?? "120"));
      if (existing) {
        if (!existing.revoked_at && !existing.consumed_at && existing.expires_at > now
          && existing.fulfillment_time_version === order.fulfillmentTimeVersion) return existing;
        // Only a confirmed schedule change may replace a still-unexpired QR.
        // Manual revocation, expiration and handoff require their original controls.
        if (existing.revoke_reason !== "SCHEDULE_CHANGED" || !existing.revoked_at
          || existing.consumed_at || existing.expires_at <= now || expiresAt <= now
          || order.fulfillmentTimeState !== "CONFIRMED") return null;
        const next = await issue(tx, order, environment, existing.version + 1, expiresAt);
        await tx.orderEvent.create({ data: {
          organizationId: order.organizationId, stallId: order.stallId, orderId,
          eventType: "LINE_PLATFORM_PICKUP_SCHEDULE_REFRESHED",
          metadataJson: { previousVersion: existing.version, version: next.version,
            fulfillmentTimeVersion: order.fulfillmentTimeVersion, expiresAt: expiresAt.toISOString() },
        } });
        return next;
      }
      if (expiresAt <= now) return null;
      return issue(tx, order, environment, 1, expiresAt);
    });
    if (!credential) return null;
    const media = decryptPlatformValue(credential.media_ciphertext, purpose(orderId, environment, "media"));
    return { imageUrl: `${origin}/api/line-platform/media/${media}`, expiresAt: credential.expires_at.toISOString(), version: credential.version };
  } catch (error) {
    if (error instanceof PickupError && error.code === "PICKUP_NOT_FOUND") return null;
    throw error;
  }
}

async function lookupCredential(tx: Transaction, stallId: string, environment: string, input: PickupLookup) {
  const where = input.kind === "QR"
    ? Prisma.sql`c.token_hash = ${hash(input.token)}`
    : Prisma.sql`c.order_id = ${input.orderId}::uuid and o.pickup_code_hash = ${hash(input.code)}
        and o.pickup_code_length = ${input.code.length}`;
  const rows = await tx.$queryRaw<Credential[]>(Prisma.sql`
    select c.* from public.line_platform_pickup_credentials c join public.orders o on o.id = c.order_id
    where c.stall_id = ${stallId}::uuid and o.stall_id = ${stallId}::uuid
      and c.environment = ${environment} and ${where} order by c.version desc limit 1
  `);
  if (!rows[0]) throw new PickupError("PICKUP_NOT_FOUND", 404);
  return rows[0];
}

function checkCredential(credential: Credential, order: Order) {
  if (credential.consumed_at) return;
  if (!canIssue(order)) throw new PickupError("PICKUP_ORDER_UNAVAILABLE");
  if (credential.revoked_at || credential.fulfillment_time_version !== order.fulfillmentTimeVersion) {
    throw new PickupError("PICKUP_REVOKED");
  }
  if (credential.expires_at <= new Date()) throw new PickupError("PICKUP_EXPIRED");
}

async function financialOperationPending(tx: Transaction, orderId: string) {
  const [row] = await tx.$queryRaw<Array<{ pending: boolean }>>`
    select exists (select 1 from public.line_platform_payment_attempts a
      where a.order_id = ${orderId}::uuid
        and a.state in ('REQUESTING', 'PENDING_AUTH', 'CONFIRMING', 'UNKNOWN', 'MANUAL_REVIEW'))
      or exists (select 1 from public.payment_provider_refunds r
        join public.payment_provider_transactions p on p.id = r.transaction_id
        where p.order_id = ${orderId}::uuid and r.status::text in ('REQUESTED', 'PROCESSING', 'UNKNOWN')) as pending
  `;
  return row.pending;
}

async function preview(tx: Transaction, credential: Credential, order: Order): Promise<PickupPreview> {
  const items = await tx.orderItem.findMany({ where: { orderId: order.id, stallId: order.stallId },
    select: { name: true, quantity: true, status: true } });
  return {
    orderId: order.id, orderNo: order.orderNo, pickupCode: order.pickupCode, version: credential.version,
    status: order.status, paymentStatus: order.paymentStatus, expiresAt: credential.expires_at.toISOString(),
    pickedUpAt: credential.consumed_at?.toISOString() ?? null,
    canRedeem: !credential.consumed_at && order.status === "READY" && order.paymentStatus === "PAID"
      && items.length > 0 && items.every((item) => item.status === "READY" || item.status === "SERVED")
      && !await financialOperationPending(tx, order.id),
    items: items.map(({ name, quantity }) => ({ name, quantity })),
  };
}

export async function previewPlatformPickup(stallId: string, input: PickupLookup) {
  const runtime = requirePickupRuntime();
  const parsed = pickupLookupSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const credential = await lookupCredential(tx, stallId, runtime.environment, parsed);
    const order = await loadOrder(tx, credential.order_id, runtime.environment, stallId);
    checkCredential(credential, order);
    return preview(tx, credential, order);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function redeemPlatformPickup(stallId: string, actorProfileId: string, input: PickupRedemption) {
  const runtime = requirePickupRuntime();
  const command = pickupRedeemSchema.parse(input);
  const fingerprint = hash(JSON.stringify({ credential: command.credential,
    expectedVersion: command.expectedVersion, confirmedHandoff: command.confirmedHandoff }));
  return prisma.$transaction(async (tx) => {
    const found = await lookupCredential(tx, stallId, runtime.environment, command.credential);
    const order = await loadOrder(tx, found.order_id, runtime.environment, stallId, true);
    const [credential] = await tx.$queryRaw<Credential[]>`
      select * from public.line_platform_pickup_credentials where id = ${found.id}::uuid for update
    `;
    const [priorKey] = await tx.$queryRaw<Credential[]>`
      select * from public.line_platform_pickup_credentials
      where environment = ${runtime.environment} and stall_id = ${stallId}::uuid
        and idempotency_key = ${command.idempotencyKey}::uuid
    `;
    if (priorKey && (priorKey.id !== credential.id || priorKey.request_hash !== fingerprint)) {
      throw new PickupError("PICKUP_IDEMPOTENCY_CONFLICT");
    }
    if (credential.version !== command.expectedVersion) throw new PickupError("PICKUP_VERSION_CONFLICT");
    checkCredential(credential, order);
    if (credential.consumed_at) return { ...await preview(tx, credential, order), alreadyRedeemed: true };
    const summary = await preview(tx, credential, order);
    if (!summary.canRedeem) throw new PickupError(order.paymentStatus !== "PAID"
      ? "PICKUP_PAYMENT_REQUIRED" : "PICKUP_NOT_READY");
    const now = new Date();
    await tx.$executeRaw`
      update public.line_platform_pickup_credentials set consumed_at = ${now},
        redeemed_by = ${actorProfileId}::uuid, redemption_method = ${command.credential.kind},
        idempotency_key = ${command.idempotencyKey}::uuid, request_hash = ${fingerprint}
      where id = ${credential.id}::uuid and consumed_at is null and revoked_at is null
    `;
    const changed = await tx.order.updateMany({
      where: { id: order.id, stallId, status: "READY", paymentStatus: "PAID",
        fulfillmentTimeVersion: order.fulfillmentTimeVersion },
      data: { status: "COMPLETED", completedAt: now, pickupVerifiedAt: now,
        pickupVerificationMethod: command.credential.kind === "QR" ? "CODE" : "MANUAL" },
    });
    if (changed.count !== 1) throw new PickupError("PICKUP_VERSION_CONFLICT");
    await tx.orderEvent.create({ data: {
      orderId: order.id, organizationId: order.organizationId, stallId,
      eventType: "LINE_PLATFORM_PICKED_UP", previousStatus: "READY", newStatus: "COMPLETED",
      createdBy: actorProfileId, metadataJson: { pickupCredentialId: credential.id,
        fulfillmentVersion: credential.version, idempotencyKey: command.idempotencyKey,
        method: command.credential.kind, pickedUpAt: now.toISOString(),
        ...(command.credential.kind === "MANUAL" ? { reason: command.credential.reason } : {}) },
    } });
    return { ...summary, status: "COMPLETED", pickedUpAt: now.toISOString(), canRedeem: false, alreadyRedeemed: false };
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002"
      || (error.code === "P2010" && error.meta?.code === "23505"))) {
      throw new PickupError("PICKUP_IDEMPOTENCY_CONFLICT");
    }
    throw error;
  });
}

export async function managePlatformPickup(stallId: string, actorProfileId: string, input: {
  orderId: string; operation: "REISSUE" | "REVOKE"; expectedVersion: number; reason: string; expiresAt?: string;
}) {
  const runtime = requirePickupRuntime();
  const command = pickupManageSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const order = await loadOrder(tx, command.orderId, runtime.environment, stallId, true);
    if (!canIssue(order)) throw new PickupError("PICKUP_ORDER_UNAVAILABLE");
    const current = await latestCredential(tx, order.id);
    if ((current?.version ?? 0) !== command.expectedVersion) throw new PickupError("PICKUP_VERSION_CONFLICT");
    if (current?.consumed_at) throw new PickupError("PICKUP_ALREADY_REDEEMED");
    const now = new Date();
    const expiresAt = command.expiresAt ? new Date(command.expiresAt)
      : pickupDeadline(order, Number(process.env.PICKUP_TOKEN_GRACE_MINUTES ?? "120"));
    if (command.operation === "REISSUE" && (expiresAt <= now
      || expiresAt.getTime() > Math.max(now.getTime(), pickupDeadline(order).getTime()) + 24 * 60 * 60_000)) {
      throw new PickupError("PICKUP_DEADLINE_INVALID", 400);
    }
    await tx.$executeRaw`update public.line_platform_pickup_credentials
      set revoked_at = ${now}, revoke_reason = ${command.operation}
      where order_id = ${order.id}::uuid and revoked_at is null and consumed_at is null`;
    const next = command.operation === "REISSUE"
      ? await issue(tx, order, runtime.environment, (current?.version ?? 0) + 1, expiresAt) : null;
    await tx.orderEvent.create({ data: {
      organizationId: order.organizationId, stallId, orderId: order.id,
      eventType: command.operation === "REISSUE" ? "LINE_PLATFORM_PICKUP_REISSUED" : "LINE_PLATFORM_PICKUP_REVOKED",
      createdBy: actorProfileId, metadataJson: { reason: command.reason, previousVersion: current?.version ?? 0,
        version: next?.version ?? current?.version ?? 0, ...(next ? { expiresAt: next.expires_at.toISOString() } : {}) },
    } });
    return { version: next?.version ?? current?.version ?? 0, revoked: !next, expiresAt: next?.expires_at.toISOString() ?? null };
  });
}

export async function getPlatformPickupManagement(stallId: string, orderId: string) {
  const runtime = requirePickupRuntime();
  return prisma.$transaction(async (tx) => {
    await loadOrder(tx, orderId, runtime.environment, stallId);
    const current = await latestCredential(tx, orderId);
    return { version: current?.version ?? 0, revoked: Boolean(current?.revoked_at),
      expiresAt: current?.expires_at.toISOString() ?? null, pickedUpAt: current?.consumed_at?.toISOString() ?? null };
  });
}

export async function renderPickupMedia(mediaToken: string) {
  const runtime = requirePickupRuntime();
  if (!pickupMediaPattern.test(mediaToken)) throw new PickupError("PICKUP_MEDIA_NOT_FOUND", 404);
  const [credential] = await prisma.$queryRaw<Credential[]>`
    select c.* from public.line_platform_pickup_credentials c join public.orders o on o.id = c.order_id
    where c.media_hash = ${hash(mediaToken)} and c.environment = ${runtime.environment}
      and c.revoked_at is null and c.consumed_at is null and c.media_expires_at > now()
      and o.status not in ('COMPLETED', 'CANCELLED', 'EXPIRED') and o.payment_status <> 'REFUNDED'
  `;
  if (!credential) throw new PickupError("PICKUP_MEDIA_NOT_FOUND", 404);
  const token = decryptPlatformValue(credential.token_ciphertext, purpose(credential.order_id, runtime.environment, "token"));
  return renderPickupPng(token);
}
