import { notFound, redirect } from "next/navigation";
import { MerchantSetupBackLink } from "@/components/merchant-setup-back-link";
import { OrganizationInvitationManager } from "@/components/organization-invitation-manager";
import { OrganizationMembershipManager } from "@/components/organization-membership-manager";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { prisma } from "@/lib/prisma";
import { authorizedStallIdsForPermission, roleLabels } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string; source?: string }> };

export default async function MerchantTeamPage({ searchParams }: PageProps) {
  const { organizationId, stallId, source } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const authorizedStallIds = authorizedStallIdsForPermission(workspace.stalls, "MANAGE_STAFF");
  const canManageOrganizationTeam = workspace.roles.some((role) => (
    role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER"
  ));
  const canManage = canManageOrganizationTeam || authorizedStallIds.length > 0;
  if (!canManage) notFound();
  const returnStallId = workspace.stalls.some((stall) => stall.id === stallId) ? stallId : undefined;

  const invitationScope = canManageOrganizationTeam
    ? { organizationId: workspace.id }
    : { organizationId: workspace.id, stallId: { in: authorizedStallIds } };
  await prisma.organizationInvitation.updateMany({
    where: { ...invitationScope, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });

  const [organizationMemberships, stallMemberships, invitations] = await Promise.all([
    canManageOrganizationTeam ? prisma.organizationMembership.findMany({
      where: { organizationId: workspace.id },
      orderBy: { createdAt: "asc" },
      include: { profile: { select: { id: true, displayName: true, email: true } } },
    }) : Promise.resolve([]),
    prisma.stallMembership.findMany({
      where: { organizationId: workspace.id, stallId: { in: authorizedStallIds } },
      orderBy: { createdAt: "asc" },
      include: {
        profile: { select: { id: true, displayName: true, email: true } },
        stall: { select: { id: true, name: true } },
      },
    }),
    prisma.organizationInvitation.findMany({
      where: invitationScope,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        role: true,
        stallId: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  const canGrantOwner = workspace.roles.some((role) => (
    role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER"
  ));

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      {source === "setup" ? (
        <div className="mb-4">
          <MerchantSetupBackLink organizationId={workspace.id} />
        </div>
      ) : returnStallId ? (
        <div className="mb-4">
          <StallSettingsBackLink stallId={returnStallId} />
        </div>
      ) : null}
      <div className="border-b border-stone-200 pb-6"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">團隊與權限</h1></div>

      <OrganizationInvitationManager
        organizationId={workspace.id}
        stalls={workspace.stalls.filter((stall) => stall.isActive && authorizedStallIds.includes(stall.id)).map((stall) => ({ id: stall.id, name: stall.name }))}
        initialInvitations={invitations.map((invitation) => ({
          ...invitation,
          role: invitation.role as "ORGANIZATION_OWNER" | "ORGANIZATION_ADMIN" | "FINANCE_VIEWER" | "STALL_MANAGER" | "STAFF" | "KITCHEN",
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        }))}
        canManageOrganizationTeam={canManageOrganizationTeam}
        canGrantOwner={canGrantOwner}
      />

      {canManageOrganizationTeam ? (
        <OrganizationMembershipManager
          organizationId={workspace.id}
          initialMemberships={organizationMemberships.map((membership) => ({
            ...membership,
            role: membership.role as "ORGANIZATION_OWNER" | "ORGANIZATION_ADMIN" | "FINANCE_VIEWER",
          }))}
          canGrantOwner={canGrantOwner}
        />
      ) : null}

      <section className="border-t border-stone-200 py-7">
        <h2 className="text-lg font-semibold">攤位成員</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {stallMemberships.map((membership) => (
            <div key={membership.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="font-medium">{membership.profile.displayName}</div><div className="mt-1 text-sm text-stone-500">{membership.profile.email} · {membership.stall.name}</div></div>
              <div className="flex items-center gap-2"><span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold">{roleLabels[membership.role]}</span>{!membership.isActive ? <span className="text-xs font-semibold text-red-700">已停用</span> : null}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
