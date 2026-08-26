import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { eventGrowthCommandSchema } from "@/server/event-growth/event-growth-contract";
import {
  applyEventGrowthCommand,
  EventGrowthOperationError,
  getEventGrowthDashboard,
} from "@/server/event-growth/event-growth-service";

type RouteContext = { params: Promise<{ organizationId: string }> };
const responseHeaders = (requestId: string) => ({ "cache-control": "no-store", "x-request-id": requestId });

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_MARKET_EVENTS");
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(await getEventGrowthDashboard(organizationId), { headers: responseHeaders(authorization.requestId) });
  } catch (error) {
    return eventGrowthErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_MARKET_EVENTS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({ organizationId, actorProfileId: authorization.principal.user.id, action: "CSRF_VALIDATION_FAILED", entityType: "EVENT_GROWTH", outcome: "DENIED", requestId: authorization.requestId, ipHash: hashClientIp(request) });
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: responseHeaders(authorization.requestId) });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = eventGrowthCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({
      error: "活動推廣資料不正確，請檢查標示欄位。",
      fieldErrors: getZodFieldErrors(parsed.error, { marketEventId: "市集活動", name: "活動名稱", source: "來源", medium: "媒介", campaignCode: "活動代碼", startsAt: "開始時間", endsAt: "結束時間", campaignId: "推廣活動", status: "活動狀態", category: "費用類別", amount: "費用金額", note: "費用說明", incurredAt: "發生時間" }),
    }, { status: 400, headers: responseHeaders(authorization.requestId) });
  }
  try {
    const result = await applyEventGrowthCommand({ organizationId, actorProfileId: authorization.principal.user.id, command: parsed.data });
    await recordAuditEvent({ organizationId, actorProfileId: authorization.principal.user.id, action: `EVENT_GROWTH_${parsed.data.operation}`, entityType: parsed.data.operation === "CREATE_EXPENSE" ? "EVENT_GROWTH_EXPENSE" : "EVENT_GROWTH_CAMPAIGN", entityId: result.id, outcome: "SUCCESS", requestId: authorization.requestId, ipHash: hashClientIp(request), metadata: { operation: parsed.data.operation } });
    return NextResponse.json(await getEventGrowthDashboard(organizationId), { headers: responseHeaders(authorization.requestId) });
  } catch (error) {
    return eventGrowthErrorResponse(error, authorization.requestId);
  }
}

function eventGrowthErrorResponse(error: unknown, requestId: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "同一活動已使用此活動代碼，請更換代碼。", fieldErrors: { campaignCode: "此活動代碼已被使用。" } }, { status: 409, headers: responseHeaders(requestId) });
  }
  const code = error instanceof EventGrowthOperationError ? error.code : "EVENT_GROWTH_UPDATE_FAILED";
  const response = code === "EVENT_GROWTH_MODULE_DISABLED"
    ? { status: 403, message: "活動推廣模組尚未對此組織開放。" }
    : code === "EVENT_GROWTH_EVENT_NOT_FOUND"
      ? { status: 404, message: "找不到指定的市集活動。" }
      : code === "EVENT_GROWTH_CAMPAIGN_NOT_FOUND"
        ? { status: 404, message: "找不到指定的推廣活動。" }
        : code === "EVENT_GROWTH_CAMPAIGN_TRANSITION_INVALID"
          ? { status: 409, message: "此推廣活動目前不能切換到指定狀態。" }
          : { status: 500, message: "目前無法更新活動推廣設定。" };
  return NextResponse.json({ error: response.message }, { status: response.status, headers: responseHeaders(requestId) });
}
