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

  const user = await prisma.userAccount.findUnique({
    where: { email: parsed.data.email },
    include: {
      memberships: {
        where: {
          isActive: true,
          stall: {
            isActive: true,
            merchant: { status: { in: ["TRIALING", "ACTIVE"] } },
          },
        },
        include: { stall: true },
        take: 1,
      },
    },
  });
  const passwordValid = await compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  const membership = user?.memberships[0];

  if (!user || !user.isActive || !passwordValid || (!membership && user.platformRole !== "PLATFORM_ADMIN")) {
    await recordAuditEvent({
      action: "LOGIN_FAILURE",
      entityType: "AUTH",
      outcome: "FAILURE",
      requestId,
      actorUserId: user?.id,
      stallId: membership?.stallId,
      ipHash,
    });
    return NextResponse.json(
      { error: "電子郵件或密碼不正確。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const session = await createSession(user.id);
  const fallbackPath = membership
    ? defaultPathForRole(membership.role, membership.stall.slug)
    : "/";
  const response = NextResponse.json(
    { next: sanitizeRedirectPath(parsed.data.next, fallbackPath) },
    { headers: { "x-request-id": requestId } },
  );
  setSessionCookies(response, session);

  await recordAuditEvent({
    tenantId: membership?.stall.merchantId,
    action: "LOGIN_SUCCESS",
    entityType: "AUTH",
    outcome: "SUCCESS",
    requestId,
    actorUserId: user.id,
    stallId: membership?.stallId,
    ipHash,
  });
  return response;
}
