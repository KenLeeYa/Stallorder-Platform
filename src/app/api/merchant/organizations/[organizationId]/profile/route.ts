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
        select: { businessName: true, email: true, phone: true },
      });
      if (!before) throw new Error("ORGANIZATION_NOT_FOUND");
      const organization = await transaction.organization.update({
        where: { id: organizationId },
        data: parsed.data,
        select: { businessName: true, email: true, phone: true },
      });
      return { before, organization };
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
    const conflictMessage = "此聯絡電子郵件已由其他商家使用。";
    return NextResponse.json(
      {
        error: conflict
          ? conflictMessage
          : notFound
            ? "找不到指定商家。"
            : "目前無法更新商家資料。",
        ...(conflict ? { fieldErrors: { email: conflictMessage } } : {}),
      },
      {
        status: conflict ? 409 : notFound ? 404 : 500,
        headers: { "x-request-id": authorization.requestId },
      },
    );
  }
}
