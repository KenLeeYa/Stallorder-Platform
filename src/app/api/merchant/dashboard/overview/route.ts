import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getDashboardOverview } from "@/lib/dashboard-data";
import { dashboardQuerySchema } from "@/lib/dashboard-validation";
import { hasPermission } from "@/lib/rbac";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { createRequestId } from "@/lib/security";

const allowedQueryKeys = new Set(["organizationId", "stallId", "dateFrom", "dateTo"]);

export async function GET(request: Request) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/api/merchant/dashboard/overview", requestId });
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !allowedQueryKeys.has(key))) {
    return finalizePerformanceResponse(
      NextResponse.json({ error: "查詢參數不正確。" }, { status: 400 }),
      timing,
    );
  }
  const parsed = dashboardQuerySchema.safeParse({
    organizationId: url.searchParams.get("organizationId"),
    stallIds: url.searchParams.getAll("stallId"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  });
  if (!parsed.success) {
    return finalizePerformanceResponse(
      NextResponse.json({ error: parsed.error.issues[0]?.message ?? "查詢條件不正確。" }, { status: 400 }),
      timing,
    );
  }

  const authorization = await timing.measure(
    "authMs",
    () => timing.measureDb(() => authorizeOrganizationApiRequest(
      request,
      parsed.data.organizationId,
      "VIEW_REPORTS",
      true,
      requestId,
    ), 4),
  );
  if (!authorization.ok) return finalizePerformanceResponse(authorization.response, timing);

  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  const availableStalls = authorization.workspace.stalls.filter(
    (stall) => stall.isActive && authorizedStallIds.has(stall.id),
  );
  const requestedIds = parsed.data.stallIds.length > 0
    ? parsed.data.stallIds
    : availableStalls.map((stall) => stall.id);
  const allowedIds = new Set(availableStalls.map((stall) => stall.id));
  if (requestedIds.some((stallId) => !allowedIds.has(stallId))) {
    return finalizePerformanceResponse(NextResponse.json(
      { error: "攤位範圍包含未授權資源。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    ), timing);
  }
  if (requestedIds.length > 1) {
    try {
      await entitlementService.assertFeatureIncluded(
        authorization.workspace.id,
        "MULTI_STALL_DASHBOARD",
      );
    } catch (error) {
      const response = entitlementErrorResponse(error, authorization.requestId);
      if (response) return response;
      throw error;
    }
  }

  const overview = await timing.measureDb(() => getDashboardOverview({
    organizationId: authorization.workspace.id,
    stalls: availableStalls.filter((stall) => requestedIds.includes(stall.id)),
    alertStallIds: availableStalls
      .filter((stall) => requestedIds.includes(stall.id))
      .filter((stall) => [...authorization.workspace.roles, ...stall.roles].some((role) => hasPermission(role, "MANAGE_ORDERING")))
      .map((stall) => stall.id),
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  }), 3);
  return finalizePerformanceResponse(NextResponse.json(overview, {
    headers: {
      "cache-control": "private, no-store",
      "x-request-id": authorization.requestId,
    },
  }), timing);
}
