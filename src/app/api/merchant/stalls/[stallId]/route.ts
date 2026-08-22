import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getStallFieldErrors, stallFieldLabels, updateStallSchema } from "@/lib/stall-validation";
import { invalidatePublicMenu, invalidatePublicQrToken } from "@/lib/public-menu";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { EntitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STALL");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = updateStallSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getStallFieldErrors(parsed.error);
    const invalidFields = Object.keys(fieldErrors).map((field) => stallFieldLabels[field as keyof typeof stallFieldLabels]);
    return NextResponse.json(
      {
        error: invalidFields.length
          ? `請檢查以下欄位：${invalidFields.join("、")}。`
          : "攤位資料格式不正確，請檢查後再試。",
        fieldErrors,
      },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const command = parsed.data;
  try {
    const { before, stall } = await prisma.$transaction(async (transaction) => {
      const before = await transaction.stall.findFirst({
        where: { id: stallId, organizationId: authorization.workspace.id },
        select: {
          name: true,
          code: true,
          description: true,
          address: true,
          phone: true,
          timezone: true,
          currency: true,
          businessStatus: true,
          orderingEnabled: true,
          isActive: true,
        },
      });
      if (!before) throw new Error("STALL_NOT_FOUND");
      if (
        command.operation === "UPDATE_BASIC"
        && normalizeImmutableStallCode(command.code) !== normalizeImmutableStallCode(before.code)
      ) {
        throw new Error("STALL_CODE_IMMUTABLE");
      }

      if (command.operation === "UPDATE_OPERATIONS" && !before.isActive && command.isActive) {
        await transaction.$queryRaw`
          select id
          from public.subscriptions
          where organization_id = ${authorization.workspace.id}::uuid
          for update
        `;
        await new EntitlementService(transaction).assertLimitAvailable(
          authorization.workspace.id,
          "STALLS",
          1,
        );
      }

      const updateData = command.operation === "UPDATE_BASIC"
        ? {
            name: command.name,
            description: command.description,
            address: command.address,
            location: command.address,
            phone: command.phone,
            timezone: command.timezone,
            currency: command.currency,
          }
        : {
            businessStatus: command.businessStatus,
            orderingEnabled: command.orderingEnabled,
            isActive: command.isActive,
          };
      const stall = await transaction.stall.update({
        where: { id: stallId, organizationId: authorization.workspace.id },
        data: updateData,
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          address: true,
          phone: true,
          timezone: true,
          currency: true,
          businessStatus: true,
          orderingEnabled: true,
          isActive: true,
        },
      });
      return { before, stall };
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: command.operation === "UPDATE_OPERATIONS" && !stall.isActive ? "STALL_DEACTIVATED" : "STALL_UPDATED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      before,
      after: stall,
      metadata: {
        operation: command.operation,
        name: stall.name,
        code: stall.code,
        businessStatus: stall.businessStatus,
        orderingEnabled: stall.orderingEnabled,
        isActive: stall.isActive,
      },
    });
    const qrCodes = await prisma.qrCode.findMany({
      where: { stallId, organizationId: authorization.workspace.id },
      select: { token: true },
    });
    invalidatePublicMenu(stallId);
    for (const qrCode of qrCodes) invalidatePublicQrToken(qrCode.token);
    return NextResponse.json(
      { stall },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const code = error instanceof Error ? error.message : "";
    if (code === "STALL_NOT_FOUND") {
      return NextResponse.json(
        { error: "找不到指定資源。" },
        { status: 404, headers: { "x-request-id": authorization.requestId } },
      );
    }
    if (code === "STALL_CODE_IMMUTABLE") {
      return NextResponse.json(
        {
          error: "攤位代碼建立後無法變更。",
          fieldErrors: {
            code: "為確保公開商店網址穩定，既有攤位代碼已鎖定，無法變更。",
          },
        },
        { status: 409, headers: { "x-request-id": authorization.requestId } },
      );
    }
    return NextResponse.json(
      {
        error: conflict ? "攤位代碼已被使用。" : "目前無法更新攤位。",
        ...(conflict ? { fieldErrors: { code: "此攤位代碼已被使用，請改用其他代碼。" } } : {}),
      },
      { status: conflict ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

function normalizeImmutableStallCode(code: string) {
  return code.trim().toUpperCase();
}
