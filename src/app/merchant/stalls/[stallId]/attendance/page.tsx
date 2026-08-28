import { notFound } from "next/navigation";
import { AttendanceManager } from "@/components/attendance-manager";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { getAttendanceManagerSnapshot } from "@/server/attendance/attendance-service";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function AttendanceManagementPage({ params }: PageProps) {
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const workspaceStall = workspace?.stalls.find((stall) => stall.id === stallId);
  if (!workspace || !workspaceStall) notFound();
  const roles = [...new Set([...workspace.roles, ...workspaceStall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_ATTENDANCE"))) notFound();
  const stall = await prisma.stall.findUnique({
    where: { id: stallId, organizationId: workspace.id },
    select: { id: true, name: true, timezone: true },
  });
  if (!stall) notFound();
  const data = await getAttendanceManagerSnapshot({
    organizationId: workspace.id,
    stallId,
    timezone: stall.timezone,
  });
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8"><ContextualBackButton fallbackHref={`/merchant/stalls/${stallId}`}>返回攤位設定</ContextualBackButton><header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">員工定位打卡</h1><p className="mt-2 text-sm text-stone-600">{stall.name} · 設定打卡範圍、動態驗證碼與覆核紀錄</p></header><div className="py-7"><AttendanceManager stallId={stallId} initialData={data} /></div></main>;
}
