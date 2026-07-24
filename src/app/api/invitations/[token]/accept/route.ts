import { NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, hashToken } from "@/lib/security";
import { createSupabaseAuthClient, isSupabaseAuthConfigured } from "@/lib/supabase-auth";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { EntitlementService } from "@/server/billing/entitlement-service";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const { token } = await context.params;
  const principal = await getRequestPrincipal(request);
  if (!principal) {
    return NextResponse.json(
      { error: "請先使用受邀的 Google 帳號登入。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }
  if (!validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const rateLimit = await checkRateLimit({
    scope: "invitation-accept",
    identifier: principal.user.id,
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "嘗試次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(rateLimit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token) || !principal.user.authUserId || !isSupabaseAuthConfigured()) {
    return NextResponse.json(
      { error: "此邀請只能由已驗證的 Google 帳號接受。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const supabase = await createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser();
  const authUser = data.user;
  const providers = Array.isArray(authUser?.app_metadata.providers)
    ? authUser.app_metadata.providers
    : [authUser?.app_metadata.provider];
  const verifiedEmail = authUser?.email?.trim().toLowerCase();
  if (
    error
    || !authUser
    || authUser.id !== principal.user.authUserId
    || !verifiedEmail
    || !authUser.email_confirmed_at
    || !providers.includes("google")
  ) {
    return NextResponse.json(
      { error: "無法驗證 Google 帳號，請重新登入。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const tokenDigest = hashToken(token);
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        select id
        from public.organization_invitations
        where token_hash = ${tokenDigest}
        for update
      `;
      const invitation = await transaction.organizationInvitation.findUnique({
        where: { tokenHash: tokenDigest },
        include: { organization: true, stall: true },
      });
      if (!invitation || invitation.status !== "PENDING") throw new Error("INVITATION_UNAVAILABLE");
      if (invitation.expiresAt <= new Date()) throw new Error("INVITATION_EXPIRED");
      if (
        invitation.email !== verifiedEmail
        || principal.user.email.trim().toLowerCase() !== verifiedEmail
      ) {
        throw new Error("INVITATION_EMAIL_MISMATCH");
      }

      const existingMembership = invitation.stallId
        ? await transaction.stallMembership.findUnique({
          where: {
            stallId_profileId_role: {
              stallId: invitation.stallId,
              profileId: principal.user.id,
              role: invitation.role,
            },
          },
          select: { isActive: true },
        })
        : await transaction.organizationMembership.findUnique({
          where: {
            organizationId_profileId_role: {
              organizationId: invitation.organizationId,
              profileId: principal.user.id,
              role: invitation.role,
            },
          },
          select: { isActive: true },
        });
      if (invitation.role !== "ORGANIZATION_OWNER") {
        await new EntitlementService(transaction).assertLimitAvailable(
          invitation.organizationId,
          "STAFF",
          existingMembership?.isActive ? 0 : 1,
        );
      }

      let membershipId: string;
      if (invitation.stallId) {
        const membership = await transaction.stallMembership.upsert({
          where: {
            stallId_profileId_role: {
              stallId: invitation.stallId,
              profileId: principal.user.id,
              role: invitation.role,
            },
          },
          update: { isActive: true },
          create: {
            organizationId: invitation.organizationId,
            stallId: invitation.stallId,
            profileId: principal.user.id,
            role: invitation.role,
          },
        });
        membershipId = membership.id;
      } else {
        const membership = await transaction.organizationMembership.upsert({
          where: {
            organizationId_profileId_role: {
              organizationId: invitation.organizationId,
              profileId: principal.user.id,
              role: invitation.role,
            },
          },
          update: { isActive: true, allStalls: true },
          create: {
            organizationId: invitation.organizationId,
            profileId: principal.user.id,
            role: invitation.role,
            allStalls: true,
          },
        });
        membershipId = membership.id;
      }

      const accepted = await transaction.organizationInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", expiresAt: { gt: new Date() } },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (accepted.count !== 1) throw new Error("INVITATION_UNAVAILABLE");

      await transaction.auditLog.createMany({
        data: [{
          organizationId: invitation.organizationId,
          stallId: invitation.stallId,
          actorProfileId: principal.user.id,
          action: "TEAM_INVITATION_ACCEPTED",
          entityType: "ORGANIZATION_INVITATION",
          entityId: invitation.id,
          outcome: "SUCCESS",
          requestId,
          ipHash: hashClientIp(request),
          beforeJson: { status: "PENDING" },
          afterJson: { status: "ACCEPTED", role: invitation.role, email: verifiedEmail },
        }, {
          organizationId: invitation.organizationId,
          stallId: invitation.stallId,
          actorProfileId: principal.user.id,
          action: invitation.stallId ? "STALL_ROLE_GRANTED" : "ORGANIZATION_ROLE_GRANTED",
          entityType: invitation.stallId ? "STALL_MEMBERSHIP" : "ORGANIZATION_MEMBERSHIP",
          entityId: membershipId,
          outcome: "SUCCESS",
          requestId,
          ipHash: hashClientIp(request),
          afterJson: { invitationId: invitation.id, role: invitation.role, email: verifiedEmail },
        }],
      });

      const next = invitation.stall
        ? invitation.role === "STAFF" || invitation.role === "KITCHEN"
          ? `/staff/${invitation.stall.slug}`
          : `/merchant/${invitation.stall.slug}`
        : `/merchant/dashboard?organizationId=${invitation.organizationId}`;
      return { next };
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    });
  } catch (caughtError) {
    const entitlementResponse = entitlementErrorResponse(caughtError, requestId);
    if (entitlementResponse) return entitlementResponse;
    const code = caughtError instanceof Error ? caughtError.message : "";
    if (code === "INVITATION_EXPIRED") {
      await prisma.organizationInvitation.updateMany({
        where: { tokenHash: tokenDigest, status: "PENDING", expiresAt: { lte: new Date() } },
        data: { status: "EXPIRED" },
      });
    }
    const messages: Record<string, string> = {
      INVITATION_UNAVAILABLE: "此邀請不存在、已失效或已被使用。",
      INVITATION_EXPIRED: "此邀請已過期，請聯絡管理員重新邀請。",
      INVITATION_EMAIL_MISMATCH: "目前 Google 帳號的 Email 與邀請不符。",
    };
    return NextResponse.json(
      { error: messages[code] ?? "目前無法接受邀請。" },
      {
        status: code === "INVITATION_EMAIL_MISMATCH" ? 403 : code ? 409 : 500,
        headers: { "x-request-id": requestId },
      },
    );
  }
}
