import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { updateStallSchema } from "@/lib/stall-validation";

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
    return NextResponse.json(
      { error: "攤位資料格式不正確，停用攤位前也必須再次確認。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const data = { ...parsed.data };
  delete data.confirmation;
  try {
    const stall = await prisma.stall.update({
      where: { id: stallId, organizationId: authorization.workspace.id },
      data: { ...data, location: data.address },
      select: {
        id: true,
        name: true,
        code: true,
        businessStatus: true,
        orderingEnabled: true,
        isActive: true,
      },
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: stall.isActive ? "STALL_UPDATED" : "STALL_DEACTIVATED",
      entityType: "STALL",
      entityId: stall.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      metadata: {
        name: stall.name,
        code: stall.code,
        businessStatus: stall.businessStatus,
        orderingEnabled: stall.orderingEnabled,
        isActive: stall.isActive,
      },
    });
    return NextResponse.json(
      { stall },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json(
      { error: conflict ? "攤位代碼已被使用。" : "目前無法更新攤位。" },
      { status: conflict ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
