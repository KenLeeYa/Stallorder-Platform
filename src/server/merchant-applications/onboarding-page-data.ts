import { prisma } from "@/lib/prisma";
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";
import { getApplicantApplication } from "@/server/merchant-applications/merchant-application-service";
import { getPendingMerchantSetupPath } from "@/server/merchant-applications/merchant-setup-service";

type PlatformRole = Parameters<typeof getWorkspaceAccess>[1];

export async function loadOnboardingData(profileId: string, email: string, platformRole: PlatformRole) {
  const now = new Date();
  const [profile, application, trial, workspaces, pendingInvitation, pendingSetupPath] = await Promise.all([
    prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { displayName: true, email: true, avatarUrl: true },
    }),
    getApplicantApplication(profileId),
    prisma.planVersion.findFirstOrThrow({
      where: {
        plan: { code: "TRIAL", isActive: true },
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
      },
      orderBy: { version: "desc" },
      select: {
        displayName: true,
        trialDays: true,
        maxStalls: true,
        maxStaff: true,
        maxProducts: true,
        maxQrCodes: true,
        includedOrders: true,
        overagePolicy: true,
      },
    }),
    getWorkspaceAccess(profileId, platformRole),
    prisma.organizationInvitation.count({
      where: { email, status: "PENDING", expiresAt: { gt: now } },
    }),
    getPendingMerchantSetupPath(profileId),
  ]);

  return {
    profile,
    application,
    trial,
    pendingInvitation: pendingInvitation > 0,
    workspacePath: pendingSetupPath ?? (workspaces.length > 0 ? getDefaultWorkspacePath(workspaces) : null),
  };
}

export function serializeApplicationInitialValues(
  application: Awaited<ReturnType<typeof getApplicantApplication>>,
) {
  if (!application) return null;
  return {
    ...application,
    expectedStartDate: application.expectedStartDate?.toISOString().slice(0, 10) ?? null,
  };
}
