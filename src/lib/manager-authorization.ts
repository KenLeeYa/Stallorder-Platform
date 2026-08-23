import "server-only";

import { compare } from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";

export const managerAuthorizationCodeSchema = z.string()
  .trim()
  .regex(/^\d{4,8}$/, "授權碼必須是 4～8 位數字。");

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

  const limit = await checkRateLimit({
    scope: "manager-authorization-code",
    identifier: `${input.stallId}:${input.actorProfileId}:${input.operation}`,
    limit: 8,
    windowMs: 5 * 60_000,
  });
  if (!limit.allowed) throw new ManagerAuthorizationError("RATE_LIMITED");

  const settings = await prisma.stallOrderingSettings.findUnique({
    where: { stallId: input.stallId },
    select: { managerAuthorizationCodeHash: true },
  });
  if (!settings?.managerAuthorizationCodeHash) {
    throw new ManagerAuthorizationError("CODE_NOT_CONFIGURED");
  }
  if (!(await compare(authorizationCode, settings.managerAuthorizationCodeHash))) {
    throw new ManagerAuthorizationError("INVALID_CODE");
  }

  return { method: "SHARED_CODE" as const, approvedById: input.actorProfileId };
}
