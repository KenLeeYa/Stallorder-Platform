import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { defaultBusinessHours } from "@/lib/business-hours";
import { newStallOrderingSettings } from "@/lib/new-stall-ordering-defaults";
import { prisma } from "@/lib/prisma";
import {
  createStallSchema,
  getCreateStallConflictFieldErrors,
  getStallFieldErrors,
  stallFieldLabels,
} from "@/lib/stall-validation";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import {
  assertGlobalStallCodeAvailable,
  GlobalStallCodeConflictError,
} from "@/server/stalls/global-stall-code-guard";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_ORGANIZATION",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = createStallSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getStallFieldErrors(parsed.error);
    const invalidFields = Object.keys(fieldErrors).map((field) => stallFieldLabels[field as keyof typeof stallFieldLabels]);
    return NextResponse.json(
      {
        error: invalidFields.length
          ? `請檢查以下欄位：${invalidFields.join("、")}。`
          : "攤位資料格式不正確。",
        fieldErrors,
      },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    await entitlementService.assertLimitAvailable(organizationId, "STALLS", 1);
    const stall = await prisma.$transaction(async (transaction) => {
      await assertGlobalStallCodeAvailable(transaction, parsed.data.code);
      return transaction.stall.create({
        data: {
          organizationId,
          ...parsed.data,
          location: parsed.data.address,
          orderingSettings: { create: newStallOrderingSettings(organizationId) },
          businessHours: { create: defaultBusinessHours.map((hour) => ({ organizationId, ...hour })) },
          qrCodes: {
            create: {
              organizationId,
              token: randomBytes(32).toString("base64url"),
              label: "主要點餐 QR v1",
            },
          },
        },
        select: { id: true, name: true, slug: true, code: true },
      });
    });

    await recordAuditEvent({
      organizationId,
      stallId: stall.id,
      actorProfileId: authorization.principal.user.id,
      action: "STALL_CREATED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      after: { name: stall.name, slug: stall.slug, code: stall.code },
      metadata: { name: stall.name, code: stall.code },
    });
    return NextResponse.json(
      { stall },
      { status: 201, headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const conflictError = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      ? error
      : null;
    const conflict = error instanceof GlobalStallCodeConflictError || Boolean(conflictError);
    const entitlementCode = error instanceof Error ? error.message : "";
    const entitlementMessages: Record<string, string> = {
      SUBSCRIPTION_REQUIRED: "此組織尚未建立訂閱，無法新增攤位。",
      SUBSCRIPTION_INACTIVE: "訂閱目前不可新增攤位，請先處理訂閱狀態。",
      PLAN_STALL_LIMIT: "已達方案可建立的攤位上限。",
      ADDITIONAL_STALL_APPROVAL_REQUIRED: "此攤位需要平台管理員先核准額外攤位額度。",
    };
    const entitlementMessage = entitlementMessages[entitlementCode];
    return NextResponse.json(
      {
        error: conflict ? "攤位代碼或公開識別名稱已被使用。" : entitlementMessage ?? "目前無法建立攤位。",
        ...(conflict ? {
          fieldErrors: error instanceof GlobalStallCodeConflictError
            ? { code: "此攤位代碼已被使用，請改用其他代碼。" }
            : getCreateStallConflictFieldErrors(conflictError?.meta?.target),
        } : {}),
      },
      { status: conflict || entitlementMessage ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
