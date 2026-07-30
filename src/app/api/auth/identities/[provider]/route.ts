import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearSessionCookies,
  getRequestPrincipal,
  revokeAllProfileSessions,
} from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  hashClientIp,
  hashToken,
  isTrustedOrigin,
  sanitizeRedirectPath,
} from "@/lib/security";
import { hashOAuthEvidence } from "@/server/auth/oauth/crypto";
import { resolveOAuthFeatureState } from "@/server/auth/oauth/feature-flags";
import {
  getEnabledOAuthProviderAdapter,
  getOAuthRedirectUri,
} from "@/server/auth/oauth/provider-registry";
import { createOAuthTransaction } from "@/server/auth/oauth/transaction-service";
import { parseOAuthProvider } from "@/server/auth/oauth/types";

type RouteContext = { params: Promise<{ provider: string }> };

const linkSchema = z.object({
  invitationToken: z.string().min(40).max(100).regex(/^[A-Za-z0-9_-]+$/).optional(),
  returnTo: z.string().max(500).optional(),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  const requestId = createRequestId();
  const provider = parseOAuthProvider((await params).provider);
  if (!provider) {
    return NextResponse.json(
      { error: "不支援的登入方式。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "無法驗證帳號綁定來源。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  const body = await readJson(request, requestId, { maxBytes: 4096 });
  if (body.error) return body.error;
  const parsed = linkSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "帳號綁定資料格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const ipHash = hashClientIp(request);
  const principal = await getRequestPrincipal(request);
  if (principal && !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  const limit = await checkRateLimit({
    scope: `oauth-link-${provider.toLowerCase()}`,
    identifier: principal?.user.id ?? ipHash,
    limit: 10,
    windowMs: 30 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "帳號綁定嘗試次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  const flags = await resolveOAuthFeatureState(provider);
  if (!flags.foundation || !flags.provider || !flags.linking) {
    return NextResponse.json(
      { error: "此帳號綁定方式目前尚未開放。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }

  let invitationId: string | undefined;
  if (parsed.data.invitationToken) {
    const invitation = await prisma.authIdentityLinkInvitation.findUnique({
      where: { tokenHash: hashToken(parsed.data.invitationToken) },
      select: {
        id: true,
        allowedProviders: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    });
    if (
      !invitation
      || invitation.usedAt
      || invitation.revokedAt
      || invitation.expiresAt <= new Date()
      || !invitation.allowedProviders.includes(provider)
    ) {
      return NextResponse.json(
        { error: "帳號綁定邀請無效或已過期。" },
        { status: 404, headers: { "x-request-id": requestId } },
      );
    }
    invitationId = invitation.id;
  } else {
    if (!principal) {
      return NextResponse.json(
        { error: "請先登入，或使用有效的帳號綁定邀請。" },
        { status: 401, headers: { "x-request-id": requestId } },
      );
    }
    const currentSession = await prisma.authSession.findUnique({
      where: { id: principal.sessionId },
      select: { issuedAt: true, revokedAt: true },
    });
    if (
      !currentSession
      || currentSession.revokedAt
      || currentSession.issuedAt < new Date(Date.now() - 10 * 60_000)
    ) {
      return NextResponse.json(
        { error: "請重新登入後再綁定其他登入方式。" },
        { status: 403, headers: { "x-request-id": requestId } },
      );
    }
  }

  try {
    const adapter = await getEnabledOAuthProviderAdapter(provider);
    const redirectUri = getOAuthRedirectUri(provider);
    const transaction = await createOAuthTransaction({
      provider,
      redirectUri,
      returnTo: sanitizeRedirectPath(parsed.data.returnTo, "/select-organization"),
      currentProfileId: invitationId ? undefined : principal?.user.id,
      invitationId,
    });
    const authorizationUrl = await adapter.buildAuthorizationUrl({
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: transaction.codeChallenge,
      redirectUri,
    });
    await recordAuditEvent({
      action: "OAUTH_IDENTITY_LINK_STARTED",
      entityType: "OAUTH_TRANSACTION",
      entityId: transaction.transactionId,
      outcome: "SUCCESS",
      requestId,
      actorProfileId: principal?.user.id,
      ipHash,
      metadata: { provider, invitation: Boolean(invitationId) },
    });
    return NextResponse.json(
      { authorizationUrl: authorizationUrl.toString() },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    return NextResponse.json(
      { error: "目前無法啟動帳號綁定。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const requestId = createRequestId();
  const provider = parseOAuthProvider((await params).provider);
  const principal = await getRequestPrincipal(request);
  if (!provider || !principal) {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
  if (!validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  const currentSession = await prisma.authSession.findUnique({
    where: { id: principal.sessionId },
    select: { issuedAt: true, revokedAt: true },
  });
  if (
    !currentSession
    || currentSession.revokedAt
    || currentSession.issuedAt < new Date(Date.now() - 10 * 60_000)
  ) {
    return NextResponse.json(
      { error: "請重新登入後再解除登入方式。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  const flags = await resolveOAuthFeatureState(provider);
  if (!flags.foundation || !flags.linking) {
    return NextResponse.json(
      { error: "帳號解除綁定目前尚未開放。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
  if (provider === "APPLE") {
    return NextResponse.json(
      { error: "Apple 解除綁定需先完成 Provider 撤銷程序，請聯絡平台管理員。" },
      { status: 409, headers: { "x-request-id": requestId } },
    );
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const identity = await transaction.authIdentity.findUnique({
        where: {
          profileId_provider: {
            profileId: principal.user.id,
            provider,
          },
        },
      });
      if (!identity || identity.revokedAt) throw new Error("IDENTITY_NOT_FOUND");
      const otherIdentities = await transaction.authIdentity.count({
        where: {
          profileId: principal.user.id,
          revokedAt: null,
          id: { not: identity.id },
        },
      });
      if (otherIdentities === 0) {
        throw new Error("LAST_IDENTITY");
      }
      await transaction.authIdentity.update({
        where: { id: identity.id },
        data: { revokedAt: new Date() },
      });
      await revokeAllProfileSessions(
        principal.user.id,
        "IDENTITY_UNLINKED",
        transaction,
      );
      await transaction.auditLog.create({
        data: {
          actorProfileId: principal.user.id,
          action: "IDENTITY_UNLINKED",
          entityType: "AUTH_IDENTITY",
          entityId: identity.id,
          outcome: "SUCCESS",
          requestId,
          ipHash: hashClientIp(request),
          metadata: JSON.stringify({
            provider,
            providerSubjectHash: hashOAuthEvidence(identity.providerSubject),
          }),
        },
      });
      return { id: identity.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const response = NextResponse.json(
      { ok: true, identityId: result.id, reauthenticationRequired: true },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
    clearSessionCookies(response);
    return response;
  } catch (error) {
    const lastIdentity = error instanceof Error && error.message === "LAST_IDENTITY";
    return NextResponse.json(
      {
        error: lastIdentity
          ? "至少需保留一個可用的登入方式。"
          : "找不到可解除的登入身分。",
      },
      { status: lastIdentity ? 409 : 404, headers: { "x-request-id": requestId } },
    );
  }
}
