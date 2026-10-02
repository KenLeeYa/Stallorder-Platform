import "server-only";

import { notFound, redirect } from "next/navigation";
import { dashboardDateRange } from "@/lib/dashboard-validation";
import { calendarDateInTimeZone } from "@/lib/date-time";
import { authorizedStallIdsForPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import type { WorkspaceOrganization } from "@/lib/workspace";

export function resolveReportReadScope(workspace: WorkspaceOrganization, requestedIds: string[], dateFrom?: string, dateTo?: string) {
  const permittedIds = new Set(authorizedStallIdsForPermission(workspace.stalls, "VIEW_REPORTS"));
  const availableStalls = workspace.stalls.filter((stall) => stall.isActive && permittedIds.has(stall.id));
  const ids = new Set(availableStalls.map((stall) => stall.id));
  if (requestedIds.length > 50 || new Set(requestedIds).size !== requestedIds.length || requestedIds.some((id) => !ids.has(id))) throw new Error("OPERATIONS_NOT_FOUND");
  const selected = availableStalls.filter((stall) => requestedIds.length === 0 || requestedIds.includes(stall.id));
  if (selected.length === 0) throw new Error("OPERATIONS_NOT_FOUND");
  const from = dateFrom ?? taipeiToday(); const to = dateTo ?? taipeiToday();
  if (!dashboardDateRange(from, to).ok) throw new Error("OPERATIONS_INVALID_DATES");
  return { workspace, availableStalls, stalls: selected, dateFrom: from, dateTo: to };
}

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
  const { principal, workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  const requestedIds = typeof stallId === "string" ? [stallId] : stallId ?? [];
  try { return { principal, ...resolveReportReadScope(workspace, requestedIds, dateFrom, dateTo) }; }
  catch { notFound(); }
}

function taipeiToday() {
  return calendarDateInTimeZone(new Date(), "Asia/Taipei");
}
