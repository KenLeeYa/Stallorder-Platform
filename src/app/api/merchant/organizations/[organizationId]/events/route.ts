import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
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
    const fieldErrors = getZodFieldErrors(parsed.error, {
      name: "活動名稱",
      slug: "活動代稱",
      description: "活動說明",
      venueName: "場地名稱",
      address: "活動地址",
      latitude: "緯度",
      longitude: "經度",
      startsAt: "開始時間",
      endsAt: "結束時間",
      organizer: "主辦單位",
      publicUrl: "公開網址",
      isPublic: "公開顯示",
      reason: "刪除原因",
    });
    return NextResponse.json(
      { error: "活動資料不正確，請檢查標示欄位。", fieldErrors },
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = JSON.stringify(error.meta?.target ?? "").toLowerCase();
      if (!target.includes("slug")) {
        return NextResponse.json(
          { error: "目前無法更新市集活動。" },
          { status: 500, headers: noStoreHeaders(authorization.requestId) },
        );
      }
      const message = "此活動代稱已被使用，請改用其他代稱。";
      return NextResponse.json(
        { error: message, fieldErrors: { slug: message } },
        { status: 409, headers: noStoreHeaders(authorization.requestId) },
      );
    }
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}
