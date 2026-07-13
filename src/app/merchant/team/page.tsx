import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasPermission, roleLabels } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantTeamPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const authorizedStallIds = workspace.stalls.map((stall) => stall.id);
  const canManageOrganizationTeam = workspace.roles.some((role) => hasPermission(role, "MANAGE_STAFF"));
  const canManage = canManageOrganizationTeam
    || workspace.stalls.some((stall) => stall.roles.some((role) => hasPermission(role, "MANAGE_STAFF")));
  if (!canManage) notFound();

  const [organizationMemberships, stallMemberships] = await Promise.all([
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
  ]);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <div className="border-b border-stone-200 pb-6"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">團隊與權限</h1></div>

      <section className="py-7">
        <h2 className="text-lg font-semibold">組織成員</h2>
        <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
          {organizationMemberships.map((membership) => (
            <div key={membership.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="font-medium">{membership.profile.displayName}</div><div className="mt-1 text-sm text-stone-500">{membership.profile.email}</div></div>
              <div className="flex items-center gap-2"><span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold">{roleLabels[membership.role]}</span>{!membership.isActive ? <span className="text-xs font-semibold text-red-700">已停用</span> : null}</div>
            </div>
          ))}
        </div>
      </section>

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
