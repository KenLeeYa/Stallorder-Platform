import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, defaultPathForRole, setSessionCookies } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
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
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";

const DUMMY_PASSWORD_HASH = "$2b$12$5P3MOwUu1mkhrOn6Bt9R8etsWXlVRiTry2UyxGJL10DuiX8tvLKP6";
const loginSchema = z.object({
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  next: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const requestId = createRequestId();
  const ipHash = hashClientIp(request);

  if (!isTrustedOrigin(request)) {
    await recordAuditEvent({
      action: "LOGIN_REJECTED_ORIGIN",
      entityType: "AUTH",
      outcome: "DENIED",
      requestId,
      ipHash,
    });
    return NextResponse.json(
      { error: "無法驗證登入來源。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const body = await readJson(request, requestId);
  if (body.error) return body.error;
  const parsed = loginSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "電子郵件或密碼格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const [ipLimit, accountLimit] = await Promise.all([
    checkRateLimit({ scope: "login-ip", identifier: ipHash, limit: 20, windowMs: 15 * 60_000 }),
    checkRateLimit({
      scope: "login-account",
      identifier: `${ipHash}:${hashToken(parsed.data.email)}`,
      limit: 5,
      windowMs: 15 * 60_000,
    }),
  ]);
  const limited = !ipLimit.allowed ? ipLimit : !accountLimit.allowed ? accountLimit : null;
  if (limited) {
    await recordAuditEvent({
      action: "RATE_LIMIT_HIT",
      entityType: "AUTH",
      outcome: "DENIED",
      requestId,
      ipHash,
      metadata: { scope: "login" },
    });
    return NextResponse.json(
      { error: "登入嘗試次數過多，請稍後再試。" },
      {
        status: 429,
        headers: { "retry-after": String(limited.retryAfterSeconds), "x-request-id": requestId },
      },
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { email: parsed.data.email },
    include: {
      organizationMemberships: {
        where: {
          isActive: true,
          organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
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
            organization: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
          },
        },
        include: { stall: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  const passwordValid = await compare(parsed.data.password, profile?.passwordHash ?? DUMMY_PASSWORD_HASH);
  const organizationMembership = profile?.organizationMemberships[0];
  const stallMembership = profile?.stallMemberships[0];

  if (
    !profile
    || !profile.isActive
    || !passwordValid
    || (!organizationMembership && !stallMembership && profile.platformRole !== "PLATFORM_ADMIN")
  ) {
    await recordAuditEvent({
      action: "LOGIN_FAILURE",
      entityType: "AUTH",
      outcome: "FAILURE",
      requestId,
      actorProfileId: profile?.id,
      stallId: stallMembership?.stallId,
      ipHash,
    });
    return NextResponse.json(
      { error: "電子郵件或密碼不正確。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const session = await createSession(profile.id);
  const workspaces = await getWorkspaceAccess(profile.id, profile.platformRole);
  const fallbackPath = workspaces.length > 0
    ? getDefaultWorkspacePath(workspaces)
    : stallMembership
      ? defaultPathForRole(stallMembership.role, stallMembership.stall.slug)
      : "/";
  const response = NextResponse.json(
    { next: sanitizeRedirectPath(parsed.data.next, fallbackPath) },
    { headers: { "x-request-id": requestId } },
  );
  setSessionCookies(response, session);

  await recordAuditEvent({
    organizationId: workspaces[0]?.id ?? organizationMembership?.organizationId ?? stallMembership?.organizationId,
    action: "LOGIN_SUCCESS",
    entityType: "AUTH",
    outcome: "SUCCESS",
    requestId,
    actorProfileId: profile.id,
    stallId: stallMembership?.stallId,
    ipHash,
  });
  await prisma.profile.update({ where: { id: profile.id }, data: { lastLoginAt: new Date() } });
  return response;
}
