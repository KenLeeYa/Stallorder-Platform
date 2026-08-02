import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { businessHoursSchema, getBusinessHoursFieldErrors } from "@/lib/business-hours";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = businessHoursSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getBusinessHoursFieldErrors(parsed.error);
    return NextResponse.json(
      {
        error: Object.keys(fieldErrors).length > 0
          ? "請檢查標示的營業時間欄位。"
          : parsed.error.issues[0]?.message ?? "營業時間格式不正確。",
        fieldErrors,
      },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.workspace.id;
  await prisma.$transaction(parsed.data.hours.map((hour) => prisma.stallBusinessHour.upsert({
    where: { stallId_dayOfWeek: { stallId, dayOfWeek: hour.dayOfWeek } },
    create: { organizationId, stallId, ...hour },
    update: { ...hour },
  })));
  await recordAuditEvent({
    organizationId,
    stallId,
    actorProfileId: authorization.principal.user.id,
    action: "STALL_BUSINESS_HOURS_UPDATED",
    entityType: "STALL",
    entityId: stallId,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    after: { hours: parsed.data.hours },
  });
  return NextResponse.json(
    { hours: await prisma.stallBusinessHour.findMany({ where: { organizationId, stallId }, orderBy: { dayOfWeek: "asc" } }) },
    { headers: { "x-request-id": authorization.requestId } },
  );
}
