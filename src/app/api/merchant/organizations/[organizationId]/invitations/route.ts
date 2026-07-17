import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { organizationInvitationRoles, organizationInvitationSchema, stallInvitationRoles } from "@/lib/invitation-validation";
import { prisma } from "@/lib/prisma";
import { createOpaqueToken, hashClientIp, hashToken } from "@/lib/security";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_STAFF", true);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = organizationInvitationSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "邀請 Email、角色或攤位格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const organizationRole = organizationInvitationRoles.includes(parsed.data.role as (typeof organizationInvitationRoles)[number]);
  const stallRole = stallInvitationRoles.includes(parsed.data.role as (typeof stallInvitationRoles)[number]);
  const organizationManagers = authorization.workspace.roles.some((role) => (
    role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER"
  ));
  const canGrantStallManager = organizationManagers || authorization.workspace.roles.includes("ORGANIZATION_ADMIN");
  const canGrantOwner = authorization.workspace.roles.some((role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER");
  if (organizationRole && (!organizationManagers || parsed.data.stallId !== null)) {
    return NextResponse.json({ error: "您沒有指派此組織角色的權限。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  if (parsed.data.role === "ORGANIZATION_OWNER" && !canGrantOwner) {
    return NextResponse.json({ error: "只有組織擁有者可邀請另一位擁有者。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  if (stallRole && (!parsed.data.stallId || !authorizedStallIds.has(parsed.data.stallId))) {
    return NextResponse.json({ error: "找不到可指派的攤位。" }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  }
  if (parsed.data.role === "STALL_MANAGER" && !canGrantStallManager) {
    return NextResponse.json({ error: "只有組織擁有者或管理員可邀請攤位經理。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }

  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  try {
    await prisma.organizationInvitation.updateMany({
      where: { organizationId, status: "PENDING", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED" },
    });
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId,
        stallId: parsed.data.stallId,
        email: parsed.data.email,
        role: parsed.data.role,
        tokenHash: hashToken(token),
        invitedById: authorization.principal.user.id,
        expiresAt,
      },
      select: { id: true, email: true, role: true, stallId: true, status: true, expiresAt: true },
    });
    await recordAuditEvent({
      organizationId,
      stallId: invitation.stallId ?? undefined,
      actorProfileId: authorization.principal.user.id,
      action: "TEAM_INVITATION_CREATED",
      entityType: "ORGANIZATION_INVITATION",
      entityId: invitation.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      after: {
        email: invitation.email,
        role: invitation.role,
        stallId: invitation.stallId,
        status: invitation.status,
        expiresAt: invitation.expiresAt.toISOString(),
      },
      metadata: { email: invitation.email, role: invitation.role },
    });
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : new URL(request.url).origin;
    return NextResponse.json(
      { invitation, acceptanceUrl: `${appOrigin}/invite/${token}` },
      { status: 201, headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return NextResponse.json(
      { error: conflict ? "此 Email 已有相同範圍與角色的待接受邀請。" : "目前無法建立邀請。" },
      { status: conflict ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
