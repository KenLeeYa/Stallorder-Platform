import "server-only";

import { compare } from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit, releaseRateLimitToken } from "@/lib/rate-limit";

export const managerAuthorizationCodeSchema = z.string()
  .trim()
  .regex(/^\d{6,8}$/, "授權碼必須是 6～8 位數字。");

export const newManagerAuthorizationCodeSchema = z.string()
  .trim()
  .regex(/^\d{6,8}$/, "新授權碼必須是 6～8 位數字。");

export type SensitiveOperation =
  | "HIGH_DISCOUNT"
  | "CANCEL_ORDER"
  | "CANCEL_COMPLETED_ORDER"
  | "CHANGE_COMPLETED_PAYMENT"
  | "CASH_REFUND"
  | "CASH_OUT"
  | "OPEN_CASH_DRAWER";

export class ManagerAuthorizationError extends Error {
  constructor(public readonly code:
    | "CODE_REQUIRED"
    | "CODE_NOT_CONFIGURED"
    | "INVALID_CODE"
    | "RATE_LIMITED") {
    super(code);
  }
}

export async function verifyManagerAuthorization(input: {
  stallId: string;
  actorProfileId: string;
  actorRoles: readonly UserRole[];
  operation: SensitiveOperation;
  authorizationCode?: string | null;
}) {
  if (input.actorRoles.some((role) => hasPermission(role, "APPROVE_DISCOUNT"))) {
    return { method: "ROLE" as const, approvedById: input.actorProfileId };
  }

  const authorizationCode = input.authorizationCode?.trim() ?? "";
  if (!authorizationCode) throw new ManagerAuthorizationError("CODE_REQUIRED");
  if (!managerAuthorizationCodeSchema.safeParse(authorizationCode).success) {
    throw new ManagerAuthorizationError("INVALID_CODE");
  }

  const settings = await prisma.stallOrderingSettings.findUnique({
    where: { stallId: input.stallId },
    select: {
      managerAuthorizationCodeHash: true,
      managerAuthorizationCodeUpdatedAt: true,
    },
  });
  if (!settings?.managerAuthorizationCodeHash) {
    throw new ManagerAuthorizationError("CODE_NOT_CONFIGURED");
  }
  const codeVersion = settings.managerAuthorizationCodeUpdatedAt?.getTime() ?? 0;
  const actorRateLimitKey = {
    scope: "manager-authorization-code:actor",
    identifier: `${input.stallId}:${codeVersion}:${input.actorProfileId}`,
  };
  const limit = await checkRateLimit({
    ...actorRateLimitKey,
    limit: 3,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    logEvent("warn", "MANAGER_AUTHORIZATION_CODE_LOCKED", {
      stallId: input.stallId,
      codeVersion,
      actorProfileId: input.actorProfileId,
    });
    throw new ManagerAuthorizationError("RATE_LIMITED");
  }
  const stallRateLimitKey = {
    scope: "manager-authorization-code:stall",
    identifier: `${input.stallId}:${codeVersion}`,
  };
  const stallLimit = await checkRateLimit({
    ...stallRateLimitKey,
    limit: 8,
    windowMs: 15 * 60_000,
  });
  if (!stallLimit.allowed) {
    await releaseRateLimitToken(actorRateLimitKey);
    logEvent("warn", "MANAGER_AUTHORIZATION_CODE_LOCKED", {
      stallId: input.stallId,
      codeVersion,
    });
    throw new ManagerAuthorizationError("RATE_LIMITED");
  }
  if (!(await compare(authorizationCode, settings.managerAuthorizationCodeHash))) {
    throw new ManagerAuthorizationError("INVALID_CODE");
  }
  await Promise.all([
    releaseRateLimitToken(actorRateLimitKey),
    releaseRateLimitToken(stallRateLimitKey),
  ]);

  return { method: "SHARED_CODE" as const, approvedById: input.actorProfileId };
}
