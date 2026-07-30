import "server-only";

import { type Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const noActiveOAuthIdentity = {
  authIdentities: { none: { revokedAt: null } },
} satisfies Prisma.ProfileWhereInput;

export async function getOAuthMigrationReadiness() {
  const privilegedAccess = {
    OR: [
      { platformRole: UserRole.PLATFORM_ADMIN },
      {
        organizationMemberships: {
          some: {
            isActive: true,
            role: {
              in: [
                UserRole.ORGANIZATION_OWNER,
                UserRole.ORGANIZATION_ADMIN,
                UserRole.FINANCE_VIEWER,
              ],
            },
          },
        },
      },
      {
        stallMemberships: {
          some: {
            isActive: true,
            role: {
              in: [UserRole.STALL_MANAGER, UserRole.STAFF, UserRole.KITCHEN],
            },
          },
        },
      },
    ],
  } satisfies Prisma.ProfileWhereInput;
  const [
    activeProfiles,
    activeProfilesWithIdentity,
    activePasswordProfiles,
    activePasswordProfilesWithoutIdentity,
    privilegedProfilesWithoutIdentity,
    migrationRequiredProfiles,
    providers,
  ] = await Promise.all([
    prisma.profile.count({ where: { isActive: true } }),
    prisma.profile.count({
      where: { isActive: true, authIdentities: { some: { revokedAt: null } } },
    }),
    prisma.profile.count({
      where: { isActive: true, passwordHash: { not: null } },
    }),
    prisma.profile.count({
      where: {
        isActive: true,
        passwordHash: { not: null },
        ...noActiveOAuthIdentity,
      },
    }),
    prisma.profile.count({
      where: {
        isActive: true,
        ...noActiveOAuthIdentity,
        ...privilegedAccess,
      },
    }),
    prisma.profile.count({
      where: { isActive: true, authMigrationRequired: true },
    }),
    prisma.authIdentity.groupBy({
      by: ["provider"],
      where: { revokedAt: null },
      _count: { _all: true },
    }),
  ]);

  const readyForOAuthOnly = privilegedProfilesWithoutIdentity === 0
    && activePasswordProfilesWithoutIdentity === 0;
  return {
    readyForOAuthOnly,
    blockers: {
      privilegedProfilesWithoutIdentity,
      activePasswordProfilesWithoutIdentity,
    },
    counts: {
      activeProfiles,
      activeProfilesWithIdentity,
      activeProfilesWithoutIdentity: activeProfiles - activeProfilesWithIdentity,
      activePasswordProfiles,
      migrationRequiredProfiles,
      identitiesByProvider: Object.fromEntries(
        providers.map((provider) => [provider.provider, provider._count._all]),
      ),
    },
    generatedAt: new Date().toISOString(),
  };
}
