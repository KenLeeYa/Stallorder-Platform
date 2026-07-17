import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { alertActionSchema } from "@/lib/operational-control";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ organizationId: string; alertId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId, alertId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_OPERATIONAL_ALERTS",
    true,
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = alertActionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "警示處理狀態不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const alert = await prisma.operationalAlert.findFirst({
    where: { id: alertId, organizationId },
  });
  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  if (!alert || !authorizedStallIds.has(alert.stallId)) {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const now = new Date();
  const update = await prisma.operationalAlert.updateMany({
    where: {
      id: alert.id,
      organizationId,
      status: parsed.data.status === "ACKNOWLEDGED" ? "ACTIVE" : { in: ["ACTIVE", "ACKNOWLEDGED"] },
    },
    data: parsed.data.status === "ACKNOWLEDGED"
      ? { status: "ACKNOWLEDGED", acknowledgedAt: now }
      : { status: "RESOLVED", resolvedAt: now },
  });
  if (update.count !== 1) {
    return NextResponse.json(
      { error: "警示已由其他人處理，請重新整理。" },
      { status: 409, headers: { "x-request-id": authorization.requestId } },
    );
  }

  await recordAuditEvent({
    organizationId,
    stallId: alert.stallId,
    actorProfileId: authorization.principal.user.id,
    action: parsed.data.status === "ACKNOWLEDGED" ? "OPERATIONAL_ALERT_ACKNOWLEDGED" : "OPERATIONAL_ALERT_RESOLVED",
    entityType: "OPERATIONAL_ALERT",
    entityId: alert.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    metadata: { alertType: alert.alertType, previousStatus: alert.status, newStatus: parsed.data.status },
  });

  return NextResponse.json(
    { alert: { id: alert.id, status: parsed.data.status } },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}
