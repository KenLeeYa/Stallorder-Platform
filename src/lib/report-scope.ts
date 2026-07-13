import "server-only";

import { notFound, redirect } from "next/navigation";
import { dashboardDateRange } from "@/lib/dashboard-validation";
import { hasPermission } from "@/lib/rbac";
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
  const roles = [...workspace.roles, ...workspace.stalls.flatMap((stall) => stall.roles)];
  if (!roles.some((role) => hasPermission(role, "VIEW_REPORTS"))) notFound();

  const requestedIds = typeof stallId === "string" ? [stallId] : stallId ?? [];
  const availableStalls = workspace.stalls.filter((stall) => stall.isActive);
  const authorizedIds = new Set(availableStalls.map((stall) => stall.id));
  if (requestedIds.some((id) => !authorizedIds.has(id))) notFound();
  const stalls = availableStalls.filter((stall) => requestedIds.length === 0 || requestedIds.includes(stall.id));
  if (stalls.length === 0) notFound();

  const today = taipeiToday();
  const defaultFrom = addDays(today, -29);
  const resolvedDateFrom = dateFrom ?? defaultFrom;
  const resolvedDateTo = dateTo ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(resolvedDateTo)) notFound();
  if (!dashboardDateRange(resolvedDateFrom, resolvedDateTo).ok) notFound();

  return { workspace, availableStalls, stalls, dateFrom: resolvedDateFrom, dateTo: resolvedDateTo };
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
