import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  createOpaqueToken,
  hashClientIp,
  hashToken,
} from "@/lib/security";
import { assertIdentityAdminScope } from "@/server/auth/oauth/admin-authorization";
import { getOAuthAppBaseUrl } from "@/server/auth/oauth/config";
import { resolveOAuthFeatureState } from "@/server/auth/oauth/feature-flags";

type RouteContext = { params: Promise<{ userId: string }> };

const invitationSchema = z.object({
  organizationId: z.string().uuid().optional(),
  allowedProviders: z.array(z.enum(["GOOGLE", "LINE", "APPLE"]))
    .min(1)
    .max(3)
    .refine((providers) => new Set(providers).size === providers.length),
  expiresInMinutes: z.number().int().min(5).max(1440).default(30),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal || !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
  const body = await readJson(request, requestId, { maxBytes: 4096 });
  if (body.error) return body.error;
  const parsed = invitationSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "帳號綁定邀請資料格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  const userId = (await params).userId;
  const limit = await checkRateLimit({
    scope: "oauth-identity-invitation",
    identifier: principal.user.id,
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "建立邀請次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  const flags = await resolveOAuthFeatureState();
  if (!flags.foundation || !flags.linking) {
    return NextResponse.json(
      { error: "帳號綁定邀請目前尚未開放。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }

  try {
    const scope = await assertIdentityAdminScope({
      principal,
      targetProfileId: userId,
      organizationId: parsed.data.organizationId,
    });
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + parsed.data.expiresInMinutes * 60_000);
    const invitation = await prisma.$transaction(async (transaction) => {
      await transaction.authIdentityLinkInvitation.updateMany({
        where: {
          profileId: userId,
          organizationId: scope.organizationId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      const created = await transaction.authIdentityLinkInvitation.create({
        data: {
          profileId: userId,
          organizationId: scope.organizationId,
          allowedProviders: parsed.data.allowedProviders,
          tokenHash: hashToken(token),
          createdByProfileId: principal.user.id,
          expiresAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: scope.organizationId,
          actorProfileId: principal.user.id,
          action: "AUTH_MIGRATION_INVITATION_CREATED",
          entityType: "AUTH_IDENTITY_LINK_INVITATION",
          entityId: created.id,
          outcome: "SUCCESS",
          requestId,
          ipHash: hashClientIp(request),
          metadata: JSON.stringify({
            targetProfileId: userId,
            allowedProviders: parsed.data.allowedProviders.join(","),
            expiresInMinutes: parsed.data.expiresInMinutes,
          }),
        },
      });
      return created;
    });
    return NextResponse.json(
      {
        invitation: {
          id: invitation.id,
          allowedProviders: invitation.allowedProviders,
          expiresAt: invitation.expiresAt.toISOString(),
          linkUrl: `${getOAuthAppBaseUrl()}/auth/link/${token}`,
        },
      },
      {
        status: 201,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      },
    );
  } catch {
    await recordAuditEvent({
      action: "AUTH_MIGRATION_INVITATION_DENIED",
      entityType: "PROFILE",
      entityId: userId,
      outcome: "DENIED",
      requestId,
      actorProfileId: principal.user.id,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
}
