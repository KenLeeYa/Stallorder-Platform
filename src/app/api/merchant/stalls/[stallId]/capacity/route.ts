import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import {
  applyCapacityMerchantCommand,
  capacityOperationErrorMessage,
  CapacityOperationError,
  getCapacityManagerData,
} from "@/lib/capacity";
import {
  capacityMerchantCommandSchema,
  getCapacityFieldErrors,
  type CapacityMerchantCommand,
} from "@/lib/capacity-contract";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_CAPACITY",
  );
  if (!authorization.ok) return authorization.response;
  try {
    const data = await getCapacityManagerData(authorization.workspace.id, stallId);
    return NextResponse.json(data, { headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    return capacityErrorResponse(error, authorization.requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_CAPACITY",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type 必須是 application/json。" },
      { status: 415, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = capacityMerchantCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getCapacityFieldErrors(parsed.error);
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "容量設定內容不正確。", fieldErrors },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const snapshot = await applyCapacityMerchantCommand({
      organizationId: authorization.workspace.id,
      stallId,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: auditAction(parsed.data),
      entityType: auditEntityType(parsed.data),
      entityId: "productId" in parsed.data ? parsed.data.productId : stallId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: auditMetadata(parsed.data),
    });
    await invalidateCapacityCaches(authorization.workspace.id, stallId);
    const data = await getCapacityManagerData(authorization.workspace.id, stallId);
    return NextResponse.json(
      { ...data, snapshot },
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return capacityErrorResponse(error, authorization.requestId);
  }
}

function auditAction(command: CapacityMerchantCommand) {
  const actions: Record<CapacityMerchantCommand["operation"], string> = {
    UPDATE_SETTINGS: "CAPACITY_SETTINGS_UPDATED",
    SET_WAIT_OVERRIDE: "WAIT_TIME_OVERRIDE_CHANGED",
    SET_AUTO_PAUSE: "CAPACITY_AUTOMATION_CHANGED",
    PAUSE_ORDERING: "CAPACITY_ORDERING_MANUALLY_PAUSED",
    RESUME_ORDERING: "CAPACITY_ORDERING_MANUALLY_RESUMED",
    UPSERT_PRODUCT_RULE: "PRODUCT_CAPACITY_RULE_UPDATED",
    DELETE_PRODUCT_RULE: "PRODUCT_CAPACITY_RULE_DELETED",
  };
  return actions[command.operation];
}

function auditEntityType(command: CapacityMerchantCommand) {
  return "productId" in command ? "PRODUCT_CAPACITY_RULE" : "STALL_CAPACITY_SETTINGS";
}

function auditMetadata(
  command: CapacityMerchantCommand,
): Record<string, string | number | boolean | null> {
  if (command.operation === "UPDATE_SETTINGS") {
    return {
      windowMinutes: command.windowMinutes,
      maxOrdersPerWindow: command.maxOrdersPerWindow,
      maxItemsPerWindow: command.maxItemsPerWindow,
      warningUtilizationPercent: command.warningUtilizationPercent,
      pauseUtilizationPercent: command.pauseUtilizationPercent,
      defaultPrepMinutes: command.defaultPrepMinutes,
      minimumQuoteMinutes: command.minimumQuoteMinutes,
      maximumQuoteMinutes: command.maximumQuoteMinutes,
      autoPauseEnabled: command.autoPauseEnabled,
      autoResumeEnabled: command.autoResumeEnabled,
      isActive: command.isActive,
    };
  }
  if (command.operation === "UPSERT_PRODUCT_RULE") {
    return {
      productId: command.productId,
      capacityWeight: command.capacityWeight,
      prepMinutes: command.prepMinutes,
      maxQuantityPerWindow: command.maxQuantityPerWindow,
      isActive: command.isActive,
    };
  }
  if (command.operation === "DELETE_PRODUCT_RULE") return { productId: command.productId };
  if (command.operation === "SET_WAIT_OVERRIDE") {
    return { minutes: command.minutes, reason: command.reason };
  }
  if (command.operation === "SET_AUTO_PAUSE") {
    return { enabled: command.enabled, reason: command.reason };
  }
  return { reason: command.reason };
}

async function invalidateCapacityCaches(organizationId: string, stallId: string) {
  invalidatePublicMenu(stallId);
  const qrCodes = await prisma.qrCode.findMany({
    where: { organizationId, stallId },
    select: { token: true },
  });
  for (const qrCode of qrCodes) invalidatePublicQrToken(qrCode.token);
}

function capacityErrorResponse(error: unknown, requestId: string) {
  const entitlementResponse = entitlementErrorResponse(error, requestId);
  if (entitlementResponse) return entitlementResponse;
  if (error instanceof CapacityOperationError) {
    const status = error.code === "STALL_NOT_FOUND" || error.code === "RULE_NOT_FOUND"
      ? 404
      : error.code.endsWith("_REQUIRED")
        ? 403
        : 409;
    return NextResponse.json(
      { error: capacityOperationErrorMessage(error), code: error.code },
      { status, headers: { "x-request-id": requestId } },
    );
  }
  throw error;
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
