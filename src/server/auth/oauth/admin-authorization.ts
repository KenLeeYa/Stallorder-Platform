import "server-only";

import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function assertIdentityAdminScope(input: {
  principal: SessionPrincipal;
  targetProfileId: string;
  organizationId?: string;
}) {
  const target = await prisma.profile.findUnique({
    where: { id: input.targetProfileId },
    select: { id: true },
  });
  if (!target) throw new Error("IDENTITY_ADMIN_TARGET_NOT_FOUND");
  if (input.principal.user.platformRole === "PLATFORM_ADMIN") {
    return { organizationId: input.organizationId ?? null };
  }
  if (!input.organizationId) throw new Error("IDENTITY_ADMIN_SCOPE_DENIED");

  const [actorMembership, targetOrganizationMembership, targetStallMembership] = await Promise.all([
    prisma.organizationMembership.count({
      where: {
        organizationId: input.organizationId,
        profileId: input.principal.user.id,
        isActive: true,
        role: { in: ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN"] },
      },
    }),
    prisma.organizationMembership.count({
      where: {
        organizationId: input.organizationId,
        profileId: input.targetProfileId,
        isActive: true,
      },
    }),
    prisma.stallMembership.count({
      where: {
        organizationId: input.organizationId,
        profileId: input.targetProfileId,
        isActive: true,
      },
    }),
  ]);
  if (
    actorMembership === 0
    || (targetOrganizationMembership === 0 && targetStallMembership === 0)
  ) {
    throw new Error("IDENTITY_ADMIN_SCOPE_DENIED");
  }
  return { organizationId: input.organizationId };
}

export async function assertIdentityInvitationAdminScope(input: {
  principal: SessionPrincipal;
  targetProfileId: string;
  organizationId?: string;
}) {
  const scope = await assertIdentityAdminScope(input);
  if (input.principal.user.platformRole === "PLATFORM_ADMIN") return scope;
  if (!input.organizationId) throw new Error("IDENTITY_ADMIN_SCOPE_DENIED");

  const [actorMembership, target] = await Promise.all([
    prisma.organizationMembership.findFirst({
      where: {
        organizationId: input.organizationId,
        profileId: input.principal.user.id,
        isActive: true,
        role: { in: ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN"] },
      },
      select: { role: true },
    }),
    prisma.profile.findUnique({
      where: { id: input.targetProfileId },
      select: {
        platformRole: true,
        organizationMemberships: {
          where: { organizationId: input.organizationId, isActive: true },
          select: { role: true },
        },
      },
    }),
  ]);
  if (!actorMembership || !target || target.platformRole) {
    throw new Error("IDENTITY_ADMIN_SCOPE_DENIED");
  }

  const targetRoles = new Set(target.organizationMemberships.map((membership) => membership.role));
  if (
    targetRoles.has("ORGANIZATION_OWNER")
    || (
      actorMembership.role === "ORGANIZATION_ADMIN"
      && targetRoles.has("ORGANIZATION_ADMIN")
    )
  ) {
    throw new Error("IDENTITY_ADMIN_SCOPE_DENIED");
  }
  return scope;
}
