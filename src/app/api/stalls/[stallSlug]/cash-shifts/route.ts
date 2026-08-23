import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import {
  CashShiftOperationError,
  cashShiftCommandSchema,
  executeCashShiftCommand,
  getCashShiftState,
} from "@/lib/cash-shifts";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import {
  ManagerAuthorizationError,
  verifyManagerAuthorization,
} from "@/lib/manager-authorization";
import { hasPermission } from "@/lib/rbac";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { getFeatureAccess } from "@/server/billing/feature-access";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_CASH_SHIFT");
  if (!authorization.ok) return authorization.response;
  const organizationId = authorization.stall.organizationId;
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "CASH_SHIFT");
    const reconciliation = await getFeatureAccess(organizationId, "CASH_RECONCILIATION");
    return NextResponse.json(
      {
        state: await getCashShiftState(authorization.stall.id, organizationId),
        permissions: {
          canManage: authorization.roles.some((role) => hasPermission(role, "MANAGE_CASH_SHIFT")),
          canReview: reconciliation.allowed
            && authorization.roles.some((role) => hasPermission(role, "REVIEW_CASH_SHIFT")),
          reconciliationEnabled: reconciliation.allowed,
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_CASH_SHIFT");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = cashShiftCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "現金交班資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const command = parsed.data;
  const reviewOperation = command.operation === "REVIEW" || command.operation === "ADJUST";
  const permission = reviewOperation ? "REVIEW_CASH_SHIFT" : "MANAGE_CASH_SHIFT";
  if (!authorization.roles.some((role) => hasPermission(role, permission))) {
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "AUTHORIZATION_DENIED",
      entityType: "CASH_SHIFT",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { permission, operation: command.operation },
    });
    return NextResponse.json(
      { error: "您的角色沒有執行此操作的權限。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationId = authorization.stall.organizationId;
  const stallId = authorization.stall.id;
  try {
    await entitlementService.assertFeatureEnabled(organizationId, "CASH_SHIFT");
    const reconciliation = await getFeatureAccess(organizationId, "CASH_RECONCILIATION");
    if (reviewOperation && !reconciliation.allowed) {
      return NextResponse.json(
        { error: reconciliation.message },
        { status: 403, headers: { "x-request-id": authorization.requestId } },
      );
    }

    const sensitiveCommand = command.operation === "REFUND"
      ? {
          operation: "CASH_REFUND" as const,
          authorizationCode: command.managerAuthorizationCode,
          shiftId: command.shiftId,
        }
      : command.operation === "MOVE" && command.type === "CASH_OUT"
        ? {
            operation: "CASH_OUT" as const,
            authorizationCode: command.managerAuthorizationCode,
            shiftId: command.shiftId,
          }
        : null;
    if (sensitiveCommand) {
      try {
        await verifyManagerAuthorization({
          stallId,
          actorProfileId: authorization.principal.user.id,
          actorRoles: authorization.roles,
          operation: sensitiveCommand.operation,
          authorizationCode: sensitiveCommand.authorizationCode,
        });
      } catch (error) {
        if (!(error instanceof ManagerAuthorizationError)) throw error;
        await recordAuditEvent({
          organizationId,
          stallId,
          actorProfileId: authorization.principal.user.id,
          action: `${sensitiveCommand.operation}_AUTHORIZATION_FAILED`,
          entityType: "CASH_SHIFT",
          entityId: sensitiveCommand.shiftId,
          outcome: "DENIED",
          requestId: authorization.requestId,
          ipHash: hashClientIp(request),
          metadata: { reason: error.code },
        });
        return managerAuthorizationErrorResponse(error, authorization.requestId);
      }
    }

    const result = await executeCashShiftCommand({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      reconciliationEnabled: reconciliation.allowed,
      command,
    });

    await recordAuditEvent({
      organizationId,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: result.action,
      entityType: result.entityType,
      entityId: result.entityId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: result.metadata,
    });
    return NextResponse.json(
      {
        state: await getCashShiftState(stallId, organizationId),
        permissions: {
          canManage: authorization.roles.some((role) => hasPermission(role, "MANAGE_CASH_SHIFT")),
          canReview: reconciliation.allowed
            && authorization.roles.some((role) => hasPermission(role, "REVIEW_CASH_SHIFT")),
          reconciliationEnabled: reconciliation.allowed,
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    return cashShiftErrorResponse(error, authorization.requestId);
  }
}

function cashShiftErrorResponse(error: unknown, requestId: string) {
  const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  if (error instanceof CashShiftOperationError) {
    const messages: Record<CashShiftOperationError["code"], string> = {
      SHIFT_NOT_FOUND: "找不到指定的現金班次。",
      SHIFT_NOT_OPEN: "此現金班次已不在開班狀態，請重新整理。",
      SHIFT_NOT_REVIEWABLE: "此現金班次目前不可複核或更正。",
      PAYMENT_NOT_FOUND: "找不到指定的現金付款。",
      PAYMENT_NOT_REFUNDABLE: "此付款已退款或不可再退款。",
      ACTIVE_SHIFT_REQUIRED: "現金交易前必須先開啟現金班次。",
    };
    return NextResponse.json(
      { error: messages[error.code], code: error.code },
      { status: error.code === "SHIFT_NOT_FOUND" || error.code === "PAYMENT_NOT_FOUND" ? 404 : 409, headers: { "x-request-id": requestId } },
    );
  }
  return NextResponse.json(
    { error: duplicate ? "此攤位已有進行中的現金班次。" : "目前無法更新現金交班資料。" },
    { status: duplicate ? 409 : 500, headers: { "x-request-id": requestId } },
  );
}

function managerAuthorizationErrorResponse(error: ManagerAuthorizationError, requestId: string) {
  const messages: Record<ManagerAuthorizationError["code"], string> = {
    CODE_REQUIRED: "請由經理或老闆輸入管理授權碼。",
    CODE_NOT_CONFIGURED: "尚未設定管理授權碼，請先至安全與訂單限制設定。",
    INVALID_CODE: "管理授權碼不正確。",
    RATE_LIMITED: "管理授權碼嘗試過多，請稍後再試。",
  };
  return NextResponse.json(
    { error: messages[error.code], code: error.code },
    { status: error.code === "RATE_LIMITED" ? 429 : 403, headers: { "x-request-id": requestId } },
  );
}
