import "server-only";

import { notFound, redirect } from "next/navigation";
import { dashboardDateRange } from "@/lib/dashboard-validation";
import { calendarDateInTimeZone } from "@/lib/date-time";
import { authorizedStallIdsForPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

export async function requireReportScope({
  organizationId,
  stallId,
  dateFrom,
  dateTo,
}: {
  organizationId?: string;
  stallId?: string | string[];
  dateFrom?: string;
  dateTo?: string;
}) {
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const requestedIds = typeof stallId === "string" ? [stallId] : stallId ?? [];
  const permittedIds = new Set(authorizedStallIdsForPermission(workspace.stalls, "VIEW_REPORTS"));
  const availableStalls = workspace.stalls.filter((stall) => stall.isActive && permittedIds.has(stall.id));
  const authorizedIds = new Set(availableStalls.map((stall) => stall.id));
  if (requestedIds.some((id) => !authorizedIds.has(id))) notFound();
  const stalls = availableStalls.filter((stall) => requestedIds.length === 0 || requestedIds.includes(stall.id));
  if (stalls.length === 0) notFound();

  const today = taipeiToday();
  const resolvedDateFrom = dateFrom ?? today;
  const resolvedDateTo = dateTo ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(resolvedDateTo)) notFound();
  if (!dashboardDateRange(resolvedDateFrom, resolvedDateTo).ok) notFound();

  return { workspace, availableStalls, stalls, dateFrom: resolvedDateFrom, dateTo: resolvedDateTo };
}

function taipeiToday() {
  return calendarDateInTimeZone(new Date(), "Asia/Taipei");
}
