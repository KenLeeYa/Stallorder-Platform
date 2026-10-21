import { NextResponse } from "next/server";
import {
  mobileLoginRequestSchema,
  mobileLoginResponseSchema,
} from "@stallorder/contracts/mobile/v1";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { verifyPasswordCredential } from "@/lib/password-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  getCookieValue,
  hashClientIp,
  hashClientUserAgent,
  hashToken,
} from "@/lib/security";
import { resolveOAuthLoginFeatureState } from "@/server/auth/oauth/feature-flags";
import { resolveMobileFeatureState, isLocalMobilePilot } from "@/server/mobile/feature-flags";

export async function POST(request: Request) {
  const requestId = createRequestId();
  if (request.headers.has("authorization") || getCookieValue(request, SESSION_COOKIE)) return NextResponse.json({ code: "AMBIGUOUS_CREDENTIALS", message: "請先登出。", requestId }, {status: 400, headers: {"cache-control":"private, no-store"}});
  const featureFlags = await resolveMobileFeatureState();
  if (!featureFlags.mobileApp && !isLocalMobilePilot()) {
    return NextResponse.json(
      { code: "MOBILE_NOT_ENABLED", message: "Mobile 功能尚未開放。", requestId },
      { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const body = await readJson(request, requestId);
  if (body.error) return body.error;
  const parsed = mobileLoginRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_LOGIN", message: "電子郵件、密碼或裝置資料格式不正確。", requestId },
      { status: 400, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  let ipHash: string;
  let userAgentHash: string;
  try {
    ipHash = hashClientIp(request);
    userAgentHash = hashClientUserAgent(request);
  } catch {
    return NextResponse.json(
      { code: "CONNECTION_EVIDENCE_UNAVAILABLE", message: "目前無法驗證連線來源。", requestId },
      { status: 503, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const oauthState = await resolveOAuthLoginFeatureState();
  if (!oauthState.passwordEnabled || oauthState.oauthOnly) {
    return NextResponse.json(
      { code: "PASSWORD_LOGIN_DISABLED", message: "此環境已停用密碼登入。", requestId },
      { status: 403, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const accountHash = hashToken(parsed.data.email);
  const [ipLimit, ipAccountLimit, accountLimit] = await Promise.all([
    checkRateLimit({ scope: "mobile-login-ip", identifier: ipHash, limit: 20, windowMs: 15 * 60_000 }),
    checkRateLimit({
      scope: "mobile-login-ip-account",
      identifier: `${ipHash}:${accountHash}`,
      limit: 5,
      windowMs: 15 * 60_000,
    }),
    checkRateLimit({ scope: "mobile-login-account", identifier: accountHash, limit: 5, windowMs: 15 * 60_000 }),
  ]);
  const limited = !ipLimit.allowed
    ? ipLimit
    : !ipAccountLimit.allowed
      ? ipAccountLimit
      : !accountLimit.allowed ? accountLimit : null;
  if (limited) {
    await recordAuditEvent({
      action: "RATE_LIMIT_HIT",
      entityType: "MOBILE_AUTH",
      outcome: "DENIED",
      requestId,
      ipHash,
      metadata: { scope: "mobile-login" },
    });
    return NextResponse.json(
      { code: "RATE_LIMITED", message: "登入嘗試次數過多，請稍後再試。", requestId },
      {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": String(limited.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      isActive: true,
      passwordHash: true,
      platformRole: true,
      organizationMemberships: {
        where: { isActive: true },
        select: { organizationId: true },
        take: 1,
      },
      stallMemberships: {
        where: { isActive: true },
        select: { organizationId: true, stallId: true },
        take: 1,
      },
    },
  });
  const currentFlags = await resolveMobileFeatureState(profile?.id);
  const passwordValid = await verifyPasswordCredential(parsed.data.password, profile?.passwordHash);
  const hasWorkspace = Boolean(
    profile?.organizationMemberships[0]
    || profile?.stallMemberships[0]
    || (profile?.platformRole === "PLATFORM_ADMIN" && currentFlags.platformAdmin),
  );
  if (!currentFlags.mobileApp || !profile || !profile.isActive || !passwordValid || !hasWorkspace) {
    await recordAuditEvent({
      action: "MOBILE_LOGIN_FAILURE",
      entityType: "MOBILE_AUTH",
      outcome: "FAILURE",
      requestId,
      actorProfileId: profile?.id,
      organizationId: profile?.organizationMemberships[0]?.organizationId
        ?? profile?.stallMemberships[0]?.organizationId,
      stallId: profile?.stallMemberships[0]?.stallId,
      ipHash,
    });
    return NextResponse.json(
      { code: "INVALID_CREDENTIALS", message: "電子郵件或密碼不正確。", requestId },
      { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const session = await createSession(profile.id, {
    deviceId: parsed.data.deviceId,
    clientKind: "NATIVE",
    ipHash,
    userAgentHash,
  });
  const response = mobileLoginResponseSchema.parse({
    version: "v1",
    session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
  });
  await Promise.all([
    prisma.profile.update({ where: { id: profile.id }, data: { lastLoginAt: new Date() } }),
    recordAuditEvent({
      action: "MOBILE_LOGIN_SUCCESS",
      entityType: "MOBILE_AUTH",
      entityId: session.id,
      outcome: "SUCCESS",
      requestId,
      actorProfileId: profile.id,
      organizationId: profile.organizationMemberships[0]?.organizationId
        ?? profile.stallMemberships[0]?.organizationId,
      stallId: profile.stallMemberships[0]?.stallId,
      ipHash,
    }),
  ]);

  return NextResponse.json(response, {
    headers: { "cache-control": "private, no-store", "x-request-id": requestId },
  });
}
