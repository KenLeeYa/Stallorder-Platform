import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const membershipUpdateSchema = z.object({
  role: z.enum(["STALL_MANAGER", "STAFF", "KITCHEN"]),
  isActive: z.boolean(),
}).strict();

type RouteContext = { params: Promise<{ stallId: string; membershipId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId, membershipId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(request, stallId, "MANAGE_STAFF");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = membershipUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "成員角色格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const existing = await prisma.stallMembership.findFirst({
    where: { id: membershipId, stallId, organizationId: authorization.workspace.id },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const canManageManager = authorization.workspace.roles.some(
    (role) => role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "PLATFORM_ADMIN",
  );
  if ((existing.role === "STALL_MANAGER" || parsed.data.role === "STALL_MANAGER") && !canManageManager) {
    return NextResponse.json(
      { error: "只有組織擁有者或管理員可變更攤位經理。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const membership = await prisma.stallMembership.update({
      where: { id: existing.id },
      data: parsed.data,
      include: { profile: { select: { id: true, email: true, displayName: true } } },
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: membership.isActive ? "STALL_ROLE_CHANGED" : "STALL_ROLE_REVOKED",
      entityType: "STALL_MEMBERSHIP",
      entityId: membership.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      before: {
        targetProfileId: existing.profileId,
        role: existing.role,
        isActive: existing.isActive,
      },
      after: {
        targetProfileId: membership.profileId,
        role: membership.role,
        isActive: membership.isActive,
      },
      metadata: { targetProfileId: membership.profileId, role: membership.role },
    });
    return NextResponse.json(
      { membership },
      { headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json(
      { error: conflict ? "此成員已具有相同角色。" : "目前無法更新成員。" },
      { status: conflict ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
