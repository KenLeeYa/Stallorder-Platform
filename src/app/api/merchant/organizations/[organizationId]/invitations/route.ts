import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
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
    const fieldErrors = getZodFieldErrors(parsed.error, {
      email: "Google 帳號 Email",
      role: "角色",
      stallId: "攤位範圍",
    });
    return NextResponse.json(
      { error: "邀請資料格式不正確，請檢查標示欄位。", fieldErrors },
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
    const message = !organizationManagers
      ? "您沒有指派此組織角色的權限。"
      : "組織角色的攤位範圍必須為全部攤位。";
    return NextResponse.json(
      { error: message, fieldErrors: { [!organizationManagers ? "role" : "stallId"]: message } },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (parsed.data.role === "ORGANIZATION_OWNER" && !canGrantOwner) {
    const message = "只有組織擁有者可邀請另一位擁有者。";
    return NextResponse.json({ error: message, fieldErrors: { role: message } }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }
  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  if (stallRole && (!parsed.data.stallId || !authorizedStallIds.has(parsed.data.stallId))) {
    const message = "請選擇可指派的攤位。";
    return NextResponse.json({ error: message, fieldErrors: { stallId: message } }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  }
  if (parsed.data.role === "STALL_MANAGER" && !canGrantStallManager) {
    const message = "只有組織擁有者或管理員可邀請攤位經理。";
    return NextResponse.json({ error: message, fieldErrors: { role: message } }, { status: 403, headers: { "x-request-id": authorization.requestId } });
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
    const target = conflict ? JSON.stringify(error.meta?.target ?? "").toLowerCase() : "";
    const duplicateInvitation = conflict && (
      target.includes("organization_invitations_pending_idx")
      || (target.includes("email") && target.includes("role"))
    );
    const conflictMessage = "此 Email 已有相同範圍與角色的待接受邀請。";
    return NextResponse.json(
      {
        error: duplicateInvitation ? conflictMessage : "目前無法建立邀請。",
        ...(duplicateInvitation ? { fieldErrors: { email: conflictMessage, role: conflictMessage, stallId: conflictMessage } } : {}),
      },
      { status: duplicateInvitation ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
