import { notFound, redirect } from "next/navigation";
import { MultiStallDashboard } from "@/components/multi-stall-dashboard";
import { getDashboardOverview } from "@/lib/dashboard-data";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { authorizedStallIdsForPermission, hasPermission } from "@/lib/rbac";
import { createRequestId } from "@/lib/security";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getFeatureAccess } from "@/server/billing/feature-access";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string | string[] }> };

export default async function MerchantDashboardPage({ searchParams }: PageProps) {
  const timing = createPerformanceTiming({
    route: "/merchant/dashboard",
    requestId: createRequestId(),
  });
  const { organizationId, stallId } = await searchParams;
  const { workspaces } = await timing.measure(
    "authMs",
    () => timing.measureDb(requireWorkspacePage, 3),
  );
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const reportStallIds = new Set(authorizedStallIdsForPermission(workspace.stalls, "VIEW_REPORTS"));
  const reportStalls = workspace.stalls.filter((stall) => reportStallIds.has(stall.id));
  const activeReportStalls = reportStalls.filter((stall) => stall.isActive);
  if (activeReportStalls.length === 0) notFound();
  const multiStallAccess = await timing.measureDb(
    () => getFeatureAccess(workspace.id, "MULTI_STALL_DASHBOARD", {
      requireUsableSubscription: false,
    }),
  );

  const requestedStallIds = typeof stallId === "string" ? [stallId] : stallId ?? [];
  const activeReportStallIds = new Set(activeReportStalls.map((stall) => stall.id));
  const authorizedSelection = requestedStallIds.filter((id) => activeReportStallIds.has(id));
  const initialSelectedStallIds = (
    authorizedSelection.length > 0
      ? authorizedSelection
      : activeReportStalls.map((stall) => stall.id)
  ).slice(0, multiStallAccess.allowed ? undefined : 1);
  const selectedStalls = activeReportStalls.filter((stall) => initialSelectedStallIds.includes(stall.id));
  const alertStallIds = selectedStalls
    .filter((stall) => [...workspace.roles, ...stall.roles]
      .some((role) => hasPermission(role, "MANAGE_ORDERING")))
    .map((stall) => stall.id);
  const today = taipeiToday();
  const initialOverview = await timing.measureDb(() => getDashboardOverview({
    organizationId: workspace.id,
    stalls: selectedStalls,
    alertStallIds,
    dateFrom: today,
    dateTo: today,
  }), 3);
  timing.finish({ status: 200 });

  return (
    <MultiStallDashboard
      organizationId={workspace.id}
      organizationName={workspace.businessName}
      currency={workspace.defaultCurrency}
      stalls={reportStalls.map((stall) => ({
        id: stall.id,
        name: stall.name,
        slug: stall.slug,
        code: stall.code,
        businessStatus: stall.businessStatus,
        isActive: stall.isActive,
      }))}
      canManageOrdering={authorizedStallIdsForPermission(reportStalls, "MANAGE_ORDERING").length > 0}
      multiStallEnabled={multiStallAccess.allowed}
      initialSelectedStallIds={initialSelectedStallIds}
      initialDateRange={{ dateFrom: today, dateTo: today }}
      initialOverview={initialOverview}
    />
  );
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
