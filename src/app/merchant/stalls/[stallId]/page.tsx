import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarRange, Gauge, MapPinned, MessageCircle, MonitorUp, WalletCards } from "lucide-react";
import { StallEditor } from "@/components/stall-editor";
import { StallModulesManager } from "@/components/stall-modules-manager";
import { StallTeamManager } from "@/components/stall-team-manager";
import { StallSettingsShell } from "@/components/stall-settings-shell";
import { StallBusinessHoursManager } from "@/components/stall-business-hours-manager";
import { StallTemplateCopyManager } from "@/components/stall-template-copy-manager";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { getStallModuleState } from "@/lib/stall-modules";
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

  const [stall, moduleState, businessHours] = await Promise.all([
    prisma.stall.findUnique({
      where: { id: stallId, organizationId: workspace.id },
      include: {
        memberships: {
          orderBy: { createdAt: "asc" },
          include: { profile: { select: { id: true, displayName: true, email: true } } },
        },
      },
    }),
    getStallModuleState(stallId, workspace.id),
    prisma.stallBusinessHour.findMany({
      where: { stallId, organizationId: workspace.id },
      orderBy: { dayOfWeek: "asc" },
      select: { dayOfWeek: true, opensAt: true, closesAt: true, isClosed: true },
    }),
  ]);
  if (!stall) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-3xl px-4 py-7 md:px-8">
      <Link href={`/merchant/stalls?organizationId=${workspace.id}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回攤位管理</Link>
      <div className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">{stall.name}</h1><p className="mt-2 text-sm text-stone-500">{stall.slug}</p><div className="mt-4 flex flex-wrap gap-2"><Link href={`/merchant/stalls/${stall.id}/display`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><MonitorUp className="h-4 w-4" />CDS 取餐顯示</Link><Link href={`/merchant/stalls/${stall.id}/capacity`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Gauge className="h-4 w-4" />產能與等候時間</Link><Link href={`/merchant/stalls/${stall.id}/cash-shifts`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><WalletCards className="h-4 w-4" />現金交班報表</Link><Link href={`/merchant/stalls/${stall.id}/locations`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><MapPinned className="h-4 w-4" />常用地點</Link><Link href={`/merchant/stalls/${stall.id}/schedule`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><CalendarRange className="h-4 w-4" />出攤行程</Link><Link href={`/merchant/stalls/${stall.id}/line`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><MessageCircle className="h-4 w-4" />LINE 通知</Link></div></div>
      <div className="py-7">
        <StallSettingsShell>
        <StallEditor organizationId={workspace.id} stallId={stall.id} initial={{ name: stall.name, code: stall.code, description: stall.description, address: stall.address, phone: stall.phone, timezone: stall.timezone, currency: stall.currency, businessStatus: stall.businessStatus, orderingEnabled: stall.orderingEnabled, isActive: stall.isActive }} />
        <StallBusinessHoursManager stallId={stall.id} initialHours={businessHours} />
        <StallModulesManager
          stallId={stall.id}
          stallSlug={stall.slug}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}
          initialState={moduleState}
        />
        <StallTemplateCopyManager
          stallId={stall.id}
          sourceStalls={workspace.stalls.filter((candidate) => candidate.id !== stall.id && [...workspace.roles, ...candidate.roles].some((role) => hasPermission(role, "MANAGE_STALL"))).map((candidate) => ({ id: candidate.id, name: candidate.name }))}
        />
        <StallTeamManager stallId={stall.id} initialMemberships={stall.memberships.map((membership) => ({ id: membership.id, role: membership.role as "STALL_MANAGER" | "STAFF" | "KITCHEN", isActive: membership.isActive, profile: membership.profile }))} />
        </StallSettingsShell>
      </div>
    </main>
  );
}
