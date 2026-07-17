import "server-only";

import { compare } from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { discountRequiresApproval } from "@/lib/operational-calculations";

export class DiscountApprovalError extends Error {
  constructor(public readonly code: "REASON_REQUIRED" | "CREDENTIALS_REQUIRED" | "INVALID_MANAGER" | "RATE_LIMITED") {
    super(code);
  }
}

export async function resolveDiscountApproval(input: {
  organizationId: string;
  stallId: string;
  actorProfileId: string;
  actorRoles: readonly UserRole[];
  discountRateBps: number;
  thresholdBps: number;
  reason?: string | null;
  managerEmail?: string | null;
  managerPassword?: string | null;
}) {
  if (!discountRequiresApproval(input.discountRateBps, input.thresholdBps)) {
    return { approvedById: null, reason: null };
  }

  const reason = input.reason?.trim() ?? "";
  if (!reason) throw new DiscountApprovalError("REASON_REQUIRED");

  if (input.actorRoles.some((role) => hasPermission(role, "APPROVE_DISCOUNT"))) {
    return { approvedById: input.actorProfileId, reason };
  }

  const email = input.managerEmail?.trim().toLowerCase() ?? "";
  const password = input.managerPassword ?? "";
  if (!email || !password) throw new DiscountApprovalError("CREDENTIALS_REQUIRED");

  const approvalLimit = await checkRateLimit({
    scope: "discount-manager-approval",
    identifier: `${input.stallId}:${input.actorProfileId}`,
    limit: 10,
    windowMs: 5 * 60_000,
  });
  if (!approvalLimit.allowed) throw new DiscountApprovalError("RATE_LIMITED");

  const manager = await prisma.profile.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      platformRole: true,
      organizationMemberships: {
        where: { organizationId: input.organizationId, isActive: true },
        select: { role: true, allStalls: true },
      },
      stallMemberships: {
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          isActive: true,
        },
        select: { role: true },
      },
    },
  });
  if (!manager?.isActive || !manager.passwordHash || !(await compare(password, manager.passwordHash))) {
    throw new DiscountApprovalError("INVALID_MANAGER");
  }

  const hasDirectStallAccess = manager.stallMemberships.length > 0;
  const roles = [
    ...(manager.platformRole ? [manager.platformRole] : []),
    ...manager.organizationMemberships
      .filter((membership) => membership.role === "ORGANIZATION_OWNER" || membership.allStalls || hasDirectStallAccess)
      .map((membership) => membership.role),
    ...manager.stallMemberships.map((membership) => membership.role),
  ];
  if (!roles.some((role) => hasPermission(role, "APPROVE_DISCOUNT"))) {
    throw new DiscountApprovalError("INVALID_MANAGER");
  }

  return { approvedById: manager.id, reason };
}
