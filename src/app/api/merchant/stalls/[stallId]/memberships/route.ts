import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  getStallMembershipConflictFieldErrors,
  getStallMembershipFieldErrors,
  stallMembershipSchema,
} from "@/lib/stall-membership-contract";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
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
  const parsed = stallMembershipSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getStallMembershipFieldErrors(parsed.error);
    return NextResponse.json(
      { error: "請檢查成員 Email 與角色。", fieldErrors },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const canGrantManager = authorization.workspace.roles.some(
    (role) => role === "ORGANIZATION_OWNER" || role === "ORGANIZATION_ADMIN" || role === "PLATFORM_ADMIN",
  );
  if (parsed.data.role === "STALL_MANAGER" && !canGrantManager) {
    return NextResponse.json(
      {
        error: "只有組織擁有者或管理員可指派攤位經理。",
        fieldErrors: { role: "您目前沒有指派攤位經理的權限，請選擇其他角色。" },
      },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const profile = await prisma.profile.findFirst({
    where: {
      email: parsed.data.email,
      isActive: true,
      OR: [
        {
          organizationMemberships: {
            some: { organizationId: authorization.workspace.id, isActive: true },
          },
        },
        {
          stallMemberships: {
            some: { organizationId: authorization.workspace.id, isActive: true },
          },
        },
      ],
    },
    select: { id: true, email: true, displayName: true, isActive: true },
  });
  if (!profile?.isActive) {
    return NextResponse.json(
      {
        error: "找不到同組織的有效帳號；外部成員請改用 Email 邀請。",
        fieldErrors: { email: "找不到此 Email 對應的同組織有效帳號。" },
      },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const existingMembership = await prisma.stallMembership.findUnique({
      where: {
        stallId_profileId_role: { stallId, profileId: profile.id, role: parsed.data.role },
      },
      select: { isActive: true },
    });
    await entitlementService.assertLimitAvailable(
      authorization.workspace.id,
      "STAFF",
      existingMembership?.isActive ? 0 : 1,
    );
    const membership = await prisma.stallMembership.upsert({
      where: {
        stallId_profileId_role: { stallId, profileId: profile.id, role: parsed.data.role },
      },
      update: { isActive: true },
      create: {
        organizationId: authorization.workspace.id,
        stallId,
        profileId: profile.id,
        role: parsed.data.role,
      },
      select: { id: true, role: true, isActive: true },
    });
    await recordAuditEvent({
      organizationId: authorization.workspace.id,
      stallId,
      actorProfileId: authorization.principal.user.id,
      action: "STALL_ROLE_GRANTED",
      entityType: "STALL_MEMBERSHIP",
      entityId: membership.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      after: {
        targetProfileId: profile.id,
        role: membership.role,
        isActive: membership.isActive,
      },
      metadata: { targetProfileId: profile.id, role: membership.role },
    });
    return NextResponse.json(
      { membership: { ...membership, profile } },
      { status: 201, headers: { "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json(
      {
        error: conflict ? "此成員已具有相同角色。" : "目前無法指派成員。",
        ...(conflict ? { fieldErrors: getStallMembershipConflictFieldErrors() } : {}),
      },
      { status: conflict ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
