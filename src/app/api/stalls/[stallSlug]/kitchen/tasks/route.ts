import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { kitchenTaskCommandSchema } from "@/lib/kitchen-contract";
import {
  applyKitchenTaskUpdate,
  completeKitchenOrder,
  KitchenOperationError,
} from "@/lib/kitchen";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_PRODUCTION_TASKS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = kitchenTaskCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "KDS 操作內容不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = parsed.data.operation === "UPDATE_TASK"
      ? await applyKitchenTaskUpdate({
          organizationId: authorization.stall.organizationId,
          stallId: authorization.stall.id,
          actorProfileId: authorization.principal.user.id,
          taskId: parsed.data.taskId,
          status: parsed.data.status,
        })
      : await completeKitchenOrder({
          organizationId: authorization.stall.organizationId,
          stallId: authorization.stall.id,
          actorProfileId: authorization.principal.user.id,
          orderId: parsed.data.orderId,
        });
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: parsed.data.operation === "UPDATE_TASK"
        ? "PRODUCTION_TASK_STATUS_CHANGED"
        : "PRODUCTION_ORDER_COMPLETED",
      entityType: parsed.data.operation === "UPDATE_TASK" ? "PRODUCTION_TASK" : "ORDER",
      entityId: parsed.data.operation === "UPDATE_TASK" ? parsed.data.taskId : parsed.data.orderId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: "previousTaskStatus" in result
        ? {
            previousStatus: result.previousTaskStatus,
            newStatus: result.nextTaskStatus,
          }
        : {
            previousStatus: result.previousOrderStatus,
            newStatus: "READY",
            completedTaskCount: result.completedTaskCount,
          },
    });
    return NextResponse.json(result, { headers: { "x-request-id": authorization.requestId } });
  } catch (error) {
    if (!(error instanceof KitchenOperationError)) throw error;
    return kitchenErrorResponse(error, authorization.requestId);
  }
}

function kitchenErrorResponse(error: KitchenOperationError, requestId: string) {
  const messages: Record<KitchenOperationError["code"], string> = {
    TASK_NOT_FOUND: "找不到此生產工作。",
    TASK_TRANSITION_INVALID: "此工作已更新或目前不能執行該操作。",
    ORDER_NOT_ACTIVE: "訂單已結束，無法再修改製作狀態。",
    STATION_NOT_FOUND: "找不到此工作站。",
    STATION_IN_USE: "工作站已有歷史工作，請停用而非刪除。",
    DEFAULT_STATION_REQUIRED: "預設工作站不可刪除或變更代碼。",
    STATION_CODE_CONFLICT: "工作站代碼已存在，請使用其他代碼。",
    ASSIGNMENT_TARGET_INVALID: "商品或分類不屬於此攤位。",
    ASSIGNMENT_CONFLICT: "此商品或分類已分派工作站。",
    STATION_LIMIT_REACHED: "已達目前方案的工作站數量上限。",
  };
  return NextResponse.json(
    { error: messages[error.code], code: error.code },
    { status: error.code === "TASK_NOT_FOUND" ? 404 : 409, headers: { "x-request-id": requestId } },
  );
}
