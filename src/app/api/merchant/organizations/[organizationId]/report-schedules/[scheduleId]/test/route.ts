import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { createTestReportDelivery } from "@/lib/report-delivery";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ organizationId: string; scheduleId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId, scheduleId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_REPORT_SCHEDULES");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "SCHEDULED_REPORTS");
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
  try {
    const result = await createTestReportDelivery(scheduleId, organizationId);
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "REPORT_SCHEDULE_TESTED",
      entityType: "REPORT_SCHEDULE",
      entityId: scheduleId,
      outcome: result.status === "FAILURE" ? "FAILURE" : "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { deliveryId: result.deliveryId, deliveryStatus: result.status },
    });
    return NextResponse.json(result, { status: result.status === "FAILURE" ? 502 : 200, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
  } catch (error) {
    const notFound = error instanceof Error && error.message === "REPORT_SCHEDULE_NOT_FOUND";
    return NextResponse.json({ error: notFound ? "找不到指定排程。" : "測試寄送失敗。" }, { status: notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } });
  }
}
