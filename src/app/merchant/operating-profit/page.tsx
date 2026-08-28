import { notFound, redirect } from "next/navigation";
import { ChartNoAxesCombined } from "lucide-react";
import { OperatingProfitDashboard } from "@/components/operating-profit-dashboard";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getOperatingProfitDashboard } from "@/server/finance/operating-profit-service";

type PageProps = {
  searchParams: Promise<{
    organizationId?: string;
    stallId?: string | string[];
    dateFrom?: string;
    dateTo?: string;
  }>;
};

export default async function OperatingProfitPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!query.organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, query.organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "VIEW_REPORTS"))) notFound();
  const availableStalls = workspace.stalls.filter((stall) => stall.isActive);
  const requestedStallIds = new Set(Array.isArray(query.stallId) ? query.stallId : query.stallId ? [query.stallId] : []);
  const selectedStalls = requestedStallIds.size
    ? availableStalls.filter((stall) => requestedStallIds.has(stall.id))
    : availableStalls;
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = validDate(query.dateFrom) ? query.dateFrom : `${today.slice(0, 8)}01`;
  const dateTo = validDate(query.dateTo) ? query.dateTo : today;
  const dashboard = await getOperatingProfitDashboard({
    organizationId: workspace.id,
    stallIds: selectedStalls.map((stall) => stall.id),
    dateFrom,
    dateTo,
  });

  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-5 md:px-8 md:py-7"><header className="border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><ChartNoAxesCombined className="h-7 w-7 text-teal-700" />營業損益與成本</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">整合已完成訂單、收款、配方成本、進貨、耗損、薪資與營業支出，分開呈現損益與現金流。</p></header><div className="py-6"><OperatingProfitDashboard organizationId={workspace.id} initialDashboard={dashboard} availableStalls={availableStalls.map((stall) => ({ id: stall.id, name: stall.name }))} canManageExpenses={workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))} /></div></main>;
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
