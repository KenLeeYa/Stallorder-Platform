import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import {
  applyCapacityOperationalCommand,
  capacityOperationErrorMessage,
  CapacityOperationError,
  getStaffCapacityData,
} from "@/lib/capacity";
import { capacityStaffCommandSchema, type CapacityStaffCommand } from "@/lib/capacity-contract";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "OPERATE_CAPACITY");
  if (!authorization.ok) return authorization.response;
  try {
    const data = await getStaffCapacityData(
      authorization.stall.organizationId,
      authorization.stall.id,
    );
    return NextResponse.json(data, { headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    return capacityErrorResponse(error, authorization.requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "OPERATE_CAPACITY");
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
  const parsed = capacityStaffCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "容量操作內容不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const snapshot = await applyCapacityOperationalCommand({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      action: auditAction(parsed.data),
      entityType: "STALL_CAPACITY_SETTINGS",
      entityId: authorization.stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: "minutes" in parsed.data
        ? { minutes: parsed.data.minutes, reason: parsed.data.reason }
        : "enabled" in parsed.data
          ? { enabled: parsed.data.enabled, reason: parsed.data.reason }
          : { reason: parsed.data.reason },
    });
    await invalidateCapacityCaches(authorization.stall.organizationId, authorization.stall.id);
    const data = await getStaffCapacityData(
      authorization.stall.organizationId,
      authorization.stall.id,
    );
    return NextResponse.json(
      { ...data, snapshot },
      { headers: noStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    return capacityErrorResponse(error, authorization.requestId);
  }
}

function auditAction(command: CapacityStaffCommand) {
  const actions: Record<CapacityStaffCommand["operation"], string> = {
    SET_WAIT_OVERRIDE: "WAIT_TIME_OVERRIDE_CHANGED",
    SET_AUTO_PAUSE: "CAPACITY_AUTOMATION_CHANGED",
    PAUSE_ORDERING: "CAPACITY_ORDERING_MANUALLY_PAUSED",
    RESUME_ORDERING: "CAPACITY_ORDERING_MANUALLY_RESUMED",
  };
  return actions[command.operation];
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
    const status = error.code === "STALL_NOT_FOUND"
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
