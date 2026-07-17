import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ organizationId: string; invitationId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const { organizationId, invitationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_STAFF", true);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: { "x-request-id": authorization.requestId } });
  }

  const invitation = await prisma.organizationInvitation.findFirst({ where: { id: invitationId, organizationId } });
  const authorizedStallIds = new Set(authorization.authorizedStallIds);
  const organizationManager = authorization.workspace.roles.some(
    (role) => role === "PLATFORM_ADMIN" || role === "ORGANIZATION_OWNER",
  );
  if (!invitation || (invitation.stallId ? !authorizedStallIds.has(invitation.stallId) : !organizationManager)) {
    return NextResponse.json({ error: "找不到指定資源。" }, { status: 404, headers: { "x-request-id": authorization.requestId } });
  }
  const changed = await prisma.organizationInvitation.updateMany({
    where: { id: invitation.id, organizationId, status: "PENDING" },
    data: { status: "REVOKED" },
  });
  if (changed.count !== 1) {
    return NextResponse.json({ error: "邀請已失效或已由其他人處理。" }, { status: 409, headers: { "x-request-id": authorization.requestId } });
  }
  await recordAuditEvent({
    organizationId,
    stallId: invitation.stallId ?? undefined,
    actorProfileId: authorization.principal.user.id,
    action: "TEAM_INVITATION_REVOKED",
    entityType: "ORGANIZATION_INVITATION",
    entityId: invitation.id,
    outcome: "SUCCESS",
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
    before: { status: invitation.status },
    after: { status: "REVOKED" },
    metadata: { email: invitation.email, role: invitation.role },
  });
  return NextResponse.json({ invitation: { id: invitation.id, status: "REVOKED" } }, { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } });
}
