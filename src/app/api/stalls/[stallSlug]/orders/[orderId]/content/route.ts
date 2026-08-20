import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { StaffOrderCreateError } from "@/lib/staff-order-create";
import {
  editStaffOrderItems,
  StaffOrderEditError,
  type StaffOrderEditFailure,
} from "@/lib/staff-order-edit";
import { updateStaffOrderItemsSchema } from "@/lib/staff-order-edit-contract";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string; orderId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, orderId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "UPDATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = updateStaffOrderItemsSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "訂單商品修改格式不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await editStaffOrderItems({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      orderId,
      actorProfileId: authorization.principal.user.id,
      request: parsed.data,
    });
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "STAFF_ORDER_ITEMS_EDITED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before: result.before,
      after: result.after,
    });
    return NextResponse.json(
      { order: result.order },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "STAFF_ORDER_ITEMS_EDIT_FAILED",
      entityType: "ORDER",
      entityId: orderId,
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        reason: error instanceof StaffOrderEditError || error instanceof StaffOrderCreateError
          ? error.code
          : "UNEXPECTED_ERROR",
      },
    });
    const response = editErrorResponse(error, authorization.requestId);
    if (response) return response;
    return NextResponse.json(
      { error: "目前無法修改訂單商品，請稍後再試。" },
      { status: 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

function editErrorResponse(error: unknown, requestId: string) {
  const headers = { "x-request-id": requestId };
  if (error instanceof StaffOrderEditError) {
    const messages: Record<StaffOrderEditFailure, string> = {
      NOT_FOUND: "找不到此訂單。",
      NOT_EDITABLE_SOURCE: "只有店員建立的訂單可以修改商品內容。",
      PAYMENT_ALREADY_RECORDED: "此訂單已結帳或已套用付款資料，無法修改商品。",
      ORDER_ALREADY_STARTED: "餐點已開始製作，無法再修改訂單商品。",
      PRINT_ALREADY_STARTED: "此訂單已開始列印，請取消訂單並重新建立以避免出單內容不一致。",
      UNSUPPORTED_EXISTING_CONFIGURATION: "此訂單含無法安全回推的套餐或舊商品設定，請取消後重新建立訂單。",
      ITEM_CONFLICT: "訂單商品已變更或有重複設定，請重新整理後再試。",
      ORDER_CONFLICT: "訂單剛剛已被其他人更新，請重新整理後再試。",
    };
    return NextResponse.json(
      { error: messages[error.code], code: error.code },
      { status: error.code === "NOT_FOUND" ? 404 : 409, headers },
    );
  }
  if (error instanceof StaffOrderCreateError) {
    const messages: Partial<Record<StaffOrderCreateError["code"], string>> = {
      ORDER_LIMIT_EXCEEDED: "商品數量或備註超過此攤位設定的上限。",
      PRODUCT_UNAVAILABLE: "商品供應或價格剛剛已變更，請重新選擇。",
      INVALID_PRODUCT_NOTES: "商品註記未符合必選或數量限制。",
      ORDER_CONFLICT: "訂單剛剛已被其他人更新，請重新整理後再試。",
    };
    return NextResponse.json(
      { error: messages[error.code] ?? "目前無法修改此訂單。", code: error.code },
      { status: error.code === "ORDER_CONFLICT" ? 409 : 400, headers },
    );
  }
  return null;
}
