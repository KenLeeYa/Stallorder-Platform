import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { updateOrganizationProfileSchema } from "@/lib/organization-profile-contract";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
  const parsed = updateOrganizationProfileSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getZodFieldErrors(parsed.error, {
      businessName: "商家名稱",
      email: "聯絡電子郵件",
      phone: "聯絡電話",
      operatingMode: "營運模式",
    });
    return NextResponse.json(
      { error: "商家資料格式不正確，請檢查標示欄位。", fieldErrors },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const before = await transaction.organization.findUnique({
        where: { id: organizationId },
        select: {
          businessName: true,
          email: true,
          phone: true,
          operatingMode: true,
          _count: { select: { stalls: { where: { isActive: true } } } },
        },
      });
      if (!before) throw new Error("ORGANIZATION_NOT_FOUND");
      if (parsed.data.operatingMode === "SINGLE_STALL" && before._count.stalls > 1) {
        throw new Error("SINGLE_STALL_REQUIRES_ONE_ACTIVE_STALL");
      }
      const organization = await transaction.organization.update({
        where: { id: organizationId },
        data: parsed.data,
        select: { businessName: true, email: true, phone: true, operatingMode: true },
      });
      const beforeProfile = {
        businessName: before.businessName,
        email: before.email,
        phone: before.phone,
        operatingMode: before.operatingMode,
      };
      return { before: beforeProfile, organization };
    });

    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "ORGANIZATION_PROFILE_UPDATED",
      entityType: "ORGANIZATION",
      entityId: organizationId,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      before: result.before,
      after: result.organization,
    });
    return NextResponse.json(
      { organization: result.organization },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const uniqueTarget = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      ? JSON.stringify(error.meta?.target ?? "").toLowerCase()
      : "";
    const conflict = uniqueTarget.includes("email");
    const notFound = error instanceof Error && error.message === "ORGANIZATION_NOT_FOUND";
    const singleStallConflict = error instanceof Error && error.message === "SINGLE_STALL_REQUIRES_ONE_ACTIVE_STALL";
    const conflictMessage = "此聯絡電子郵件已由其他商家使用。";
    const singleStallMessage = "目前有兩個以上啟用攤位；請先停用多餘攤位，或維持多攤位營運。";
    return NextResponse.json(
      {
        error: conflict
          ? conflictMessage
          : singleStallConflict
            ? singleStallMessage
          : notFound
            ? "找不到指定商家。"
            : "目前無法更新商家資料。",
        ...(conflict ? { fieldErrors: { email: conflictMessage } } : {}),
        ...(singleStallConflict ? { fieldErrors: { operatingMode: singleStallMessage } } : {}),
      },
      {
        status: conflict || singleStallConflict ? 409 : notFound ? 404 : 500,
        headers: { "x-request-id": authorization.requestId },
      },
    );
  }
}
