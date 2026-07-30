import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const noIdentity = { authIdentities: { none: { revokedAt: null } } };
  const privileged = {
    OR: [
      { platformRole: "PLATFORM_ADMIN" },
      {
        organizationMemberships: {
          some: {
            isActive: true,
            role: { in: ["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "FINANCE_VIEWER"] },
          },
        },
      },
      {
        stallMemberships: {
          some: {
            isActive: true,
            role: { in: ["STALL_MANAGER", "STAFF", "KITCHEN"] },
          },
        },
      },
    ],
  };
  const [
    activeProfiles,
    withIdentity,
    passwordWithoutIdentity,
    privilegedWithoutIdentity,
    providers,
  ] = await Promise.all([
    prisma.profile.count({ where: { isActive: true } }),
    prisma.profile.count({
      where: { isActive: true, authIdentities: { some: { revokedAt: null } } },
    }),
    prisma.profile.count({
      where: { isActive: true, passwordHash: { not: null }, ...noIdentity },
    }),
    prisma.profile.count({
      where: { isActive: true, ...noIdentity, ...privileged },
    }),
    prisma.authIdentity.groupBy({
      by: ["provider"],
      where: { revokedAt: null },
      _count: { _all: true },
    }),
  ]);
  const report = {
    readyForOAuthOnly: passwordWithoutIdentity === 0 && privilegedWithoutIdentity === 0,
    blockers: {
      passwordProfilesWithoutIdentity: passwordWithoutIdentity,
      privilegedProfilesWithoutIdentity: privilegedWithoutIdentity,
    },
    counts: {
      activeProfiles,
      activeProfilesWithIdentity: withIdentity,
      activeProfilesWithoutIdentity: activeProfiles - withIdentity,
      identitiesByProvider: Object.fromEntries(
        providers.map((provider) => [provider.provider, provider._count._all]),
      ),
    },
    generatedAt: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.readyForOAuthOnly) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
