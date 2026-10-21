import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";

export const pickupTokenPattern = /^qidaigo:pickup:v1:[A-Za-z0-9_-]{43}$/;
export const pickupMediaPattern = /^qpm1_[A-Za-z0-9_-]{43}$/;
const lookupShape = [
  z.object({ kind: z.literal("QR"), token: z.string().regex(pickupTokenPattern) }).strict(),
  z.object({
    kind: z.literal("MANUAL"), orderId: z.uuid(), code: z.string().regex(/^\d{3}$|^\d{6}$/),
    reason: z.enum(["CAMERA_UNAVAILABLE", "DEVICE_LOST", "TRACKING_UNAVAILABLE"]),
    confirmedCustomerDetails: z.literal(true),
  }).strict(),
] as const;
export const pickupLookupSchema = z.discriminatedUnion("kind", lookupShape);
export const pickupRedeemSchema = z.object({
  credential: pickupLookupSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.uuid(),
  confirmedHandoff: z.literal(true),
}).strict();
export const pickupManageSchema = z.object({
  orderId: z.uuid(), operation: z.enum(["REISSUE", "REVOKE"]),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(5).max(240),
  expiresAt: z.iso.datetime().optional(),
}).strict();
export type PickupLookup = z.infer<typeof pickupLookupSchema>;
export type PickupRedemption = z.infer<typeof pickupRedeemSchema>;

export function createPickupSecrets() {
  return {
    token: `qidaigo:pickup:v1:${randomBytes(32).toString("base64url")}`,
    mediaToken: `qpm1_${randomBytes(32).toString("base64url")}`,
  };
}

export function pickupDeadline(order: {
  committedFulfillmentAt: Date | null; scheduledPickupAt: Date | null;
  requestedFulfillmentAt: Date | null; quotedReadyAt?: Date | null; createdAt: Date;
}, graceMinutes = 120) {
  if (!Number.isInteger(graceMinutes) || graceMinutes < 15 || graceMinutes > 1440) {
    throw new Error("PICKUP_GRACE_INVALID");
  }
  const base = order.committedFulfillmentAt ?? order.scheduledPickupAt
    ?? order.requestedFulfillmentAt ?? order.quotedReadyAt ?? order.createdAt;
  return new Date(base.getTime() + graceMinutes * 60_000);
}
