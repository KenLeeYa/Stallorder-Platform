import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
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
    const fieldErrors = getZodFieldErrors(parsed.error, {
      name: "地點名稱",
      address: "地址",
      latitude: "緯度",
      longitude: "經度",
      mapUrl: "地圖網址",
      instructions: "到場說明",
      reason: "刪除原因",
    });
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "地點資料不正確。", fieldErrors },
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        {
          error: "此地點名稱已被使用，請改用其他名稱。",
          fieldErrors: { name: "此地點名稱已被使用，請改用其他名稱。" },
        },
        { status: 409, headers: noStoreHeaders(authorization.requestId) },
      );
    }
    return stallScheduleErrorResponse(error, authorization.requestId);
  }
}
