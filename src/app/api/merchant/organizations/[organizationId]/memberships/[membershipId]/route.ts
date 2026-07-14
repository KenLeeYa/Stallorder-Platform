import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

const membershipUpdateSchema = z.object({
  role: z.enum(["ORGANIZATION_OWNER", "ORGANIZATION_ADMIN", "FINANCE_VIEWER"]),
  isActive: z.boolean(),
  allStalls: z.boolean(),
}).strict();

type RouteContext = { params: Promise<{ organizationId: string; membershipId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId, membershipId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_STAFF",
  );
  if (!authorization.ok) return authorization.response;
  const canManageOrganizationRoles = authorization.workspace.roles.some((role) => (
    role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER"
  ));
  if (!canManageOrganizationRoles) {
    return NextResponse.json(
      { error: "只有組織擁有者可變更組織層角色。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
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
      { error: "組織角色或權限範圍格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const existing = await prisma.organizationMembership.findFirst({
    where: { id: membershipId, organizationId },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const canGrantOwner = canManageOrganizationRoles;
  if ((existing.role === "ORGANIZATION_OWNER" || parsed.data.role === "ORGANIZATION_OWNER") && !canGrantOwner) {
    return NextResponse.json(
      { error: "只有組織擁有者可變更擁有者權限。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const nextAllStalls = parsed.data.role === "ORGANIZATION_ADMIN"
    ? parsed.data.allStalls
    : true;
  try {
    const membership = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        select id
        from public.organization_memberships
        where organization_id = ${organizationId}::uuid
          and role = 'ORGANIZATION_OWNER'::public.user_role
          and is_active
        for update
      `;
      if (
        existing.role === "ORGANIZATION_OWNER"
        && existing.isActive
        && (parsed.data.role !== "ORGANIZATION_OWNER" || !parsed.data.isActive)
      ) {
        const ownerCount = await transaction.organizationMembership.count({
          where: { organizationId, role: "ORGANIZATION_OWNER", isActive: true },
        });
        if (ownerCount <= 1) throw new Error("LAST_OWNER_REQUIRED");
      }
      return transaction.organizationMembership.update({
        where: { id: existing.id },
        data: { role: parsed.data.role, isActive: parsed.data.isActive, allStalls: nextAllStalls },
        include: { profile: { select: { id: true, email: true, displayName: true } } },
      });
    });

    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: membership.isActive ? "ORGANIZATION_ROLE_CHANGED" : "ORGANIZATION_ROLE_REVOKED",
      entityType: "ORGANIZATION_MEMBERSHIP",
      entityId: membership.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      before: {
        targetProfileId: existing.profileId,
        role: existing.role,
        isActive: existing.isActive,
        allStalls: existing.allStalls,
      },
      after: {
        targetProfileId: membership.profileId,
        role: membership.role,
        isActive: membership.isActive,
        allStalls: membership.allStalls,
      },
    });
    return NextResponse.json(
      { membership },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (caughtError) {
    const conflict = caughtError instanceof Prisma.PrismaClientKnownRequestError && caughtError.code === "P2002";
    const lastOwner = caughtError instanceof Error && caughtError.message === "LAST_OWNER_REQUIRED";
    return NextResponse.json(
      {
        error: lastOwner
          ? "組織至少必須保留一位有效擁有者。"
          : conflict
            ? "此成員已具有相同組織角色。"
            : "目前無法更新組織成員。",
      },
      {
        status: conflict || lastOwner ? 409 : 500,
        headers: { "x-request-id": authorization.requestId },
      },
    );
  }
}
