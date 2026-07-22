import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { marketEventCommandSchema } from "@/lib/stall-schedule-contract";
import {
  noStoreHeaders,
  requireJsonContentType,
  stallScheduleErrorResponse,
} from "@/lib/stall-schedule-http";
import {
  applyMarketEventCommand,
  getMarketEventManagerData,
  invalidateOrganizationSchedulePublicData,
} from "@/lib/stall-schedules";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_MARKET_EVENTS",
  );
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      await getMarketEventManagerData(organizationId),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_MARKET_EVENTS",
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
  const parsed = marketEventCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "活動資料不正確。" },
      { status: 400, headers: noStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const result = await applyMarketEventCommand({ organizationId, command: parsed.data });
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: `MARKET_EVENT_${parsed.data.operation}`,
      entityType: "MARKET_EVENT",
      entityId: "eventId" in parsed.data ? parsed.data.eventId : result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        operation: parsed.data.operation,
        ...(parsed.data.operation === "DELETE" ? { reason: parsed.data.reason } : {}),
      },
    });
    await invalidateOrganizationSchedulePublicData(organizationId);
    return NextResponse.json(
      await getMarketEventManagerData(organizationId),
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}
