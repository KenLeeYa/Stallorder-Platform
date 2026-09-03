import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, defaultPathForRole, setSessionCookies } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { getRequestDeviceLabel } from "@/lib/device-label";
import { prisma } from "@/lib/prisma";
import { verifyPasswordCredential } from "@/lib/password-auth";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { checkRateLimit, resetRateLimitBucket } from "@/lib/rate-limit";
import {
  createRequestId,
  hashClientIp,
  hashClientUserAgent,
  hashToken,
  isLocalQaQuickLoginAllowed,
  isLocalQaLoginRateLimitDisabled,
  isTrustedOrigin,
  resolveSessionDeviceId,
  sanitizeRedirectPath,
} from "@/lib/security";
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";
import { resolveOAuthLoginFeatureState } from "@/server/auth/oauth/feature-flags";
import { getPendingMerchantSetupPath } from "@/server/merchant-applications/merchant-setup-service";

const loginSchema = z.object({
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  next: z.string().max(500).optional(),
}).strict();

export async function POST(request: Request) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/api/auth/login", requestId });
  const finalize = <T extends Response>(response: T) => finalizePerformanceResponse(response, timing);
  const ipHash = hashClientIp(request);

  if (!isTrustedOrigin(request)) {
    await timing.measureDb(() => recordAuditEvent({
      action: "LOGIN_REJECTED_ORIGIN",
      entityType: "AUTH",
      outcome: "DENIED",
      requestId,
      ipHash,
    }));
    return finalize(NextResponse.json(
      { error: "無法驗證登入來源。" },
      { status: 403, headers: { "x-request-id": requestId } },
    ));
  }

  const rateLimitEnabled = !isLocalQaLoginRateLimitDisabled();
  if (rateLimitEnabled) {
    const ipLimit = await timing.measure(
      "authMs",
      () => timing.measureDb(() => checkRateLimit({
        scope: "login-ip",
        identifier: ipHash,
        limit: 20,
        windowMs: 15 * 60_000,
      })),
    );
    if (!ipLimit.allowed) {
      await timing.measureDb(() => recordAuditEvent({
        action: "RATE_LIMIT_HIT",
        entityType: "AUTH",
        outcome: "DENIED",
        requestId,
        ipHash,
        metadata: { scope: "login-ip" },
      }));
      return finalize(NextResponse.json(
        { error: "登入嘗試次數過多，請稍後再試。" },
        {
          status: 429,
          headers: { "retry-after": String(ipLimit.retryAfterSeconds), "x-request-id": requestId },
        },
      ));
    }
  }

  const body = await readJson(request, requestId);
  if (body.error) return finalize(body.error);
  const parsed = loginSchema.safeParse(body.data);
  if (!parsed.success) {
    return finalize(NextResponse.json(
      { error: "電子郵件或密碼格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    ));
  }

  const oauthState = await timing.measureDb(() => resolveOAuthLoginFeatureState());
  if (oauthState.oauthOnly && !isLocalQaQuickLoginAllowed(request, parsed.data.email)) {
    await timing.measureDb(() => recordAuditEvent({
      action: "PASSWORD_LOGIN_DISABLED",
      entityType: "AUTH",
      outcome: "DENIED",
      requestId,
      ipHash,
    }));
    return finalize(NextResponse.json(
      { error: "此環境已停用密碼登入，請使用已連結的登入方式。" },
      { status: 403, headers: { "x-request-id": requestId } },
    ));
  }

  const accountHash = rateLimitEnabled ? hashToken(parsed.data.email) : null;

  const profile = await timing.measureDb(() => prisma.profile.findUnique({
    where: { email: parsed.data.email },
    include: {
      organizationMemberships: {
        where: {
          isActive: true,
          organization: {
            status: {
              in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "SUSPENDED", "CANCELLED"],
            },
          },
        },
        include: {
          organization: {
            include: {
              stalls: { where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      stallMemberships: {
        where: {
          isActive: true,
          stall: {
            isActive: true,
            organization: {
              status: {
                in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "SUSPENDED", "CANCELLED"],
              },
            },
          },
        },
        include: { stall: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  }));
  const passwordValid = await timing.measure(
    "authMs",
    () => verifyPasswordCredential(parsed.data.password, profile?.passwordHash),
  );
  const organizationMembership = profile?.organizationMemberships[0];
  const stallMembership = profile?.stallMemberships[0];

  if (
    !profile
    || !profile.isActive
    || !passwordValid
    || (!organizationMembership && !stallMembership && profile.platformRole !== "PLATFORM_ADMIN")
  ) {
    if (accountHash) {
      const [ipAccountLimit, accountLimit] = await timing.measure(
        "authMs",
        () => timing.measureDb(() => Promise.all([
          checkRateLimit({
            scope: "login-ip-account-failure",
            identifier: `${ipHash}:${accountHash}`,
            limit: 5,
            windowMs: 15 * 60_000,
          }),
          checkRateLimit({
            scope: "login-account-failure",
            identifier: accountHash,
            limit: 5,
            windowMs: 15 * 60_000,
          }),
        ]), 2),
      );
      const limited = !ipAccountLimit.allowed ? ipAccountLimit : !accountLimit.allowed ? accountLimit : null;
      if (limited) {
        await timing.measureDb(() => recordAuditEvent({
          action: "RATE_LIMIT_HIT",
          entityType: "AUTH",
          outcome: "DENIED",
          requestId,
          actorProfileId: profile?.id,
          stallId: stallMembership?.stallId,
          ipHash,
          metadata: { scope: "login-failure" },
        }));
        return finalize(NextResponse.json(
          { error: "登入嘗試次數過多，請稍後再試。" },
          {
            status: 429,
            headers: { "retry-after": String(limited.retryAfterSeconds), "x-request-id": requestId },
          },
        ));
      }
    }
    await timing.measureDb(() => recordAuditEvent({
      action: "LOGIN_FAILURE",
      entityType: "AUTH",
      outcome: "FAILURE",
      requestId,
      actorProfileId: profile?.id,
      stallId: stallMembership?.stallId,
      ipHash,
    }));
    return finalize(NextResponse.json(
      { error: "電子郵件或密碼不正確。" },
      { status: 401, headers: { "x-request-id": requestId } },
    ));
  }

  if (accountHash) {
    try {
      await timing.measureDb(() => Promise.all([
        resetRateLimitBucket({ scope: "login-ip-account-failure", identifier: `${ipHash}:${accountHash}` }),
        resetRateLimitBucket({ scope: "login-account-failure", identifier: accountHash }),
      ]), 2);
    } catch {
      await timing.measureDb(() => recordAuditEvent({
        action: "LOGIN_FAILURE_BUCKET_RESET_FAILED",
        entityType: "AUTH",
        outcome: "FAILURE",
        requestId,
        actorProfileId: profile.id,
        ipHash,
      }));
    }
  }

  const deviceId = resolveSessionDeviceId(request);
  const [session, workspaces, pendingSetupPath] = await Promise.all([
    timing.measure(
      "sessionMs",
      () => timing.measureDb(() => createSession(profile.id, {
        deviceId,
        deviceLabel: getRequestDeviceLabel(request),
        ipHash,
        userAgentHash: hashClientUserAgent(request),
      }), 2),
    ),
    timing.measureDb(
      () => getWorkspaceAccess(profile.id, profile.platformRole),
      3,
    ),
    timing.measureDb(() => getPendingMerchantSetupPath(profile.id)),
  ]);
  const fallbackPath = profile.platformRole === "PLATFORM_ADMIN"
    ? "/admin/billing"
    : pendingSetupPath
      ? pendingSetupPath
      : workspaces.length > 0
      ? getDefaultWorkspacePath(workspaces)
    : stallMembership
      ? defaultPathForRole(stallMembership.role, stallMembership.stall.slug)
      : "/";
  const response = NextResponse.json(
    { next: sanitizeRedirectPath(parsed.data.next, fallbackPath) },
    { headers: { "x-request-id": requestId } },
  );
  setSessionCookies(response, session, deviceId);

  await timing.measureDb(() => Promise.all([
    recordAuditEvent({
      organizationId: workspaces[0]?.id ?? organizationMembership?.organizationId ?? stallMembership?.organizationId,
      action: "LOGIN_SUCCESS",
      entityType: "AUTH",
      outcome: "SUCCESS",
      requestId,
      actorProfileId: profile.id,
      stallId: stallMembership?.stallId,
      ipHash,
    }),
    prisma.profile.update({
      where: { id: profile.id },
      data: { lastLoginAt: new Date() },
    }),
  ]), 2);
  return finalize(response);
}
