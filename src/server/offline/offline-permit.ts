import "server-only";

import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  OFFLINE_APP_PROTOCOL_VERSION,
  offlineAllowedActions,
} from "@/offline/offline-contract";
import { safeEqual } from "@/lib/security";

const permitRoles = [
  "PLATFORM_ADMIN",
  "ORGANIZATION_OWNER",
  "ORGANIZATION_ADMIN",
  "STALL_MANAGER",
  "STAFF",
] as const;

export const offlinePermitPayloadSchema = z.object({
  permitId: z.string().uuid(),
  deviceId: z.string().uuid(),
  profileId: z.string().uuid(),
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  roles: z.array(z.enum(permitRoles)).min(1).max(5),
  allowedOfflineActions: z.array(z.enum(offlineAllowedActions)).min(1).max(3),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  menuSnapshotVersion: z.number().int().positive(),
  promotionEpoch: z.string().regex(/^[1-9][0-9]*$/),
  appProtocolVersion: z.literal(OFFLINE_APP_PROTOCOL_VERSION),
  storageClass: z.enum(["PERSISTENT", "BEST_EFFORT"]),
  riskLimits: z.object({
    maxOfflineDurationMinutes: z.number().int().min(15).max(720),
    maxPendingOrders: z.number().int().min(1).max(500),
    maxTotalAmount: z.number().min(0).max(99_999_999.99),
    maxSingleOrderAmount: z.number().min(0).max(99_999_999.99),
    maxManualPaymentAmount: z.number().int().min(0).max(100_000_000),
    maxTotalManualPaymentAmount: z.number().int().min(0).max(100_000_000),
    requireCustomerContactAboveAmount: z.number().int().min(0).max(100_000_000),
    managerApprovalThreshold: z.number().int().min(0).max(100_000_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 12 * 60 * 60 * 1000) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "OFFLINE_PERMIT_LIFETIME_INVALID",
    });
  }
  if (value.riskLimits.maxSingleOrderAmount > value.riskLimits.maxTotalAmount) {
    context.addIssue({
      code: "custom",
      path: ["riskLimits", "maxSingleOrderAmount"],
      message: "OFFLINE_PERMIT_AMOUNT_LIMIT_INVALID",
    });
  }
  if (
    value.riskLimits.maxManualPaymentAmount > value.riskLimits.maxSingleOrderAmount
    || value.riskLimits.maxTotalManualPaymentAmount > value.riskLimits.maxTotalAmount
    || value.riskLimits.requireCustomerContactAboveAmount > value.riskLimits.maxManualPaymentAmount
    || value.riskLimits.managerApprovalThreshold > value.riskLimits.maxManualPaymentAmount
  ) {
    context.addIssue({
      code: "custom",
      path: ["riskLimits"],
      message: "OFFLINE_PERMIT_MANUAL_PAYMENT_LIMIT_INVALID",
    });
  }
});

export type OfflinePermitPayload = z.infer<typeof offlinePermitPayloadSchema>;

function assertSigningSecret(secret: string) {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("OFFLINE_PERMIT_SIGNING_SECRET_INVALID");
  }
}

function signatureFor(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");
}

export function signOfflinePermit(payload: OfflinePermitPayload, secret: string) {
  assertSigningSecret(secret);
  const validated = offlinePermitPayloadSchema.parse(payload);
  const encodedPayload = Buffer.from(JSON.stringify(validated), "utf8").toString("base64url");
  return `v1.${encodedPayload}.${signatureFor(encodedPayload, secret)}`;
}

export function verifyOfflinePermit(
  token: string,
  secret: string,
  now = new Date(),
  options: { allowExpired?: boolean } = {},
): OfflinePermitPayload | null {
  assertSigningSecret(secret);
  if (token.length > 4096) return null;
  const [version, encodedPayload, suppliedSignature, extra] = token.split(".");
  if (version !== "v1" || !encodedPayload || !suppliedSignature || extra) return null;

  const expectedSignature = signatureFor(encodedPayload, secret);
  if (!safeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const payload = offlinePermitPayloadSchema.parse(decoded);
    if (!options.allowExpired && Date.parse(payload.expiresAt) <= now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function requireOfflinePermitSigningSecret() {
  const secret = process.env.OFFLINE_PERMIT_SIGNING_SECRET?.trim();
  if (!secret) throw new Error("OFFLINE_PERMIT_SIGNING_SECRET_REQUIRED");
  assertSigningSecret(secret);
  return secret;
}
