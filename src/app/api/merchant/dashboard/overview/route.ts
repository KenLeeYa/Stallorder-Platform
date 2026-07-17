import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getDashboardOverview } from "@/lib/dashboard-data";
import { dashboardQuerySchema } from "@/lib/dashboard-validation";
import { hasPermission } from "@/lib/rbac";

const allowedQueryKeys = new Set(["organizationId", "stallId", "dateFrom", "dateTo"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) {
    return NextResponse.json({ error: "查詢參數不正確。" }, { status: 400 });
  }
  const parsed = dashboardQuerySchema.safeParse({
    organizationId: url.searchParams.get("organizationId"),
    stallIds: url.searchParams.getAll("stallId"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "查詢條件不正確。" }, { status: 400 });
  }

  const authorization = await authorizeOrganizationApiRequest(
    request,
    parsed.data.organizationId,
    "VIEW_REPORTS",
    true,
  );
  if (!authorization.ok) return authorization.response;

  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  const availableStalls = authorization.workspace.stalls.filter(
    (stall) => stall.isActive && authorizedStallIds.has(stall.id),
  );
  const requestedIds = parsed.data.stallIds.length > 0
    ? parsed.data.stallIds
    : availableStalls.map((stall) => stall.id);
  const allowedIds = new Set(availableStalls.map((stall) => stall.id));
  if (requestedIds.some((stallId) => !allowedIds.has(stallId))) {
    return NextResponse.json(
      { error: "攤位範圍包含未授權資源。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const overview = await getDashboardOverview({
    organizationId: authorization.workspace.id,
    stalls: availableStalls.filter((stall) => requestedIds.includes(stall.id)),
    alertStallIds: availableStalls
      .filter((stall) => requestedIds.includes(stall.id))
      .filter((stall) => [...authorization.workspace.roles, ...stall.roles].some((role) => hasPermission(role, "MANAGE_ORDERING")))
      .map((stall) => stall.id),
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  });
  return NextResponse.json(overview, {
    headers: {
      "cache-control": "private, no-store",
      "x-request-id": authorization.requestId,
    },
  });
}
