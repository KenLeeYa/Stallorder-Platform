import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspacePage } from "@/lib/workspace";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function StallCashShiftReportPage({ params }: PageProps) {
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();
  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "VIEW_REPORTS") && hasPermission(role, "VIEW_CASH_SHIFT"))) {
    notFound();
  }
  redirect(`/merchant/reports/cash-shifts?organizationId=${workspace.id}&stallId=${stall.id}`);
}
