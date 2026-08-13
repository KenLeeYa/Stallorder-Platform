import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { getKitchenFieldErrors, kitchenStationCommandSchema } from "@/lib/kitchen-contract";
import {
  applyKitchenStationCommand,
  getKitchenStationConfiguration,
  KitchenOperationError,
} from "@/lib/kitchen";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_KDS");
  if (!authorization.ok) return authorization.response;
  const data = await getKitchenStationConfiguration(
    authorization.stall.organizationId,
    authorization.stall.id,
  );
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_KDS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = kitchenStationCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getKitchenFieldErrors(parsed.error);
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "工作站設定內容不正確。", fieldErrors },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await applyKitchenStationCommand(
      authorization.stall.organizationId,
      authorization.stall.id,
      parsed.data,
    );
    const entityId = "stationId" in parsed.data
      ? parsed.data.stationId
      : "assignmentId" in parsed.data ? parsed.data.assignmentId : result.id;
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: `KITCHEN_${parsed.data.operation}`,
      entityType: parsed.data.operation.includes("ASSIGNMENT") ? "KITCHEN_STATION_ASSIGNMENT" : "KITCHEN_STATION",
      entityId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json({ ok: true }, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
    if (!(error instanceof KitchenOperationError)) throw error;
    const messages: Record<KitchenOperationError["code"], string> = {
      TASK_NOT_FOUND: "找不到此生產工作。",
      TASK_TRANSITION_INVALID: "此工作目前不能更新。",
      ORDER_NOT_ACTIVE: "訂單已結束。",
      PRODUCTION_NOT_DUE: "此訂單的履約營業日尚未到。",
      STATION_NOT_FOUND: "找不到此工作站。",
      STATION_IN_USE: "工作站已有歷史工作，請改為停用。",
      DEFAULT_STATION_REQUIRED: "預設工作站不可刪除或變更代碼。",
      STATION_CODE_CONFLICT: "工作站代碼已存在，請使用其他代碼。",
      ASSIGNMENT_TARGET_INVALID: "商品或分類不屬於此攤位。",
      ASSIGNMENT_CONFLICT: "此商品或分類已分派工作站。",
      STATION_LIMIT_REACHED: "已達目前方案的工作站數量上限。",
    };
    return NextResponse.json(
      {
        error: messages[error.code],
        code: error.code,
        ...(error.code === "STATION_CODE_CONFLICT"
          ? { fieldErrors: { code: messages[error.code] } }
          : {}),
      },
      { status: error.code === "STATION_NOT_FOUND" ? 404 : 409, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
