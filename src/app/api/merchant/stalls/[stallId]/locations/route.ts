import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { stallLocationCommandSchema } from "@/lib/stall-schedule-contract";
import {
  noStoreHeaders,
  requireJsonContentType,
  stallScheduleErrorResponse,
} from "@/lib/stall-schedule-http";
import {
  applyStallLocationCommand,
  getStallLocationManagerData,
  invalidateStallSchedulePublicData,
} from "@/lib/stall-schedules";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL_LOCATIONS",
  );
  if (!authorization.ok) return authorization.response;
  try {
    const data = await getStallLocationManagerData(authorization.workspace.id, stallId);
    return NextResponse.json(data, { headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL_LOCATIONS",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  const contentTypeError = requireJsonContentType(request, authorization.requestId);
  if (contentTypeError) return contentTypeError;
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = stallLocationCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "地點資料不正確。" },
      { status: 400, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const result = await applyStallLocationCommand({
      organizationId: authorization.workspace.id,
      stallId,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: `STALL_LOCATION_${parsed.data.operation}`,
      entityType: "STALL_LOCATION",
      entityId: "locationId" in parsed.data ? parsed.data.locationId : result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        operation: parsed.data.operation,
        ...(parsed.data.operation === "DELETE" ? { reason: parsed.data.reason } : {}),
      },
    });
    await invalidateStallSchedulePublicData(authorization.workspace.id, stallId);
    return NextResponse.json(
      await getStallLocationManagerData(authorization.workspace.id, stallId),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}
