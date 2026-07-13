import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StallEditor } from "@/components/stall-editor";
import { StallTeamManager } from "@/components/stall-team-manager";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function EditStallPage({ params }: PageProps) {
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const workspaceStall = workspace?.stalls.find((stall) => stall.id === stallId);
  if (!workspace || !workspaceStall) notFound();
  const roles = [...new Set([...workspace.roles, ...workspaceStall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_STALL"))) notFound();

  const stall = await prisma.stall.findUnique({
    where: { id: stallId, organizationId: workspace.id },
    include: {
      memberships: {
        orderBy: { createdAt: "asc" },
        include: { profile: { select: { id: true, displayName: true, email: true } } },
      },
    },
  });
  if (!stall) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-3xl px-4 py-7 md:px-8">
      <Link href={`/merchant/stalls?organizationId=${workspace.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回攤位管理</Link>
      <div className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">{stall.name}</h1><p className="mt-2 text-sm text-stone-500">{stall.slug}</p></div>
      <div className="py-7">
        <StallEditor organizationId={workspace.id} stallId={stall.id} initial={{ name: stall.name, code: stall.code, description: stall.description, address: stall.address, phone: stall.phone, timezone: stall.timezone, currency: stall.currency, businessStatus: stall.businessStatus, orderingEnabled: stall.orderingEnabled, isActive: stall.isActive }} />
        <StallTeamManager stallId={stall.id} initialMemberships={stall.memberships.map((membership) => ({ id: membership.id, role: membership.role as "STALL_MANAGER" | "STAFF" | "KITCHEN", isActive: membership.isActive, profile: membership.profile }))} />
      </div>
    </main>
  );
}
