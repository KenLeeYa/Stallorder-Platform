import { NextResponse } from "next/server";
import {
  clearSessionCookies,
  rotateRequestSession,
  SESSION_COOKIE,
  setSessionCookies,
} from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrfHash } from "@/lib/csrf";
import { getRequestDeviceLabel } from "@/lib/device-label";
import { prisma } from "@/lib/prisma";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  getCookieValue,
  hashClientIp,
  hashClientUserAgent,
  hashToken,
  resolveSessionDeviceId,
} from "@/lib/security";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const token = getCookieValue(request, SESSION_COOKIE);
  const stored = token
    ? await prisma.authSession.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { csrfTokenHash: true, profileId: true },
      })
    : null;
  if (!stored || !validateCsrfHash(request, stored.csrfTokenHash)) {
    return NextResponse.json(
      { error: "無法驗證 Session 更新請求。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  let ipHash: string;
  try {
    ipHash = hashClientIp(request);
  } catch {
    return NextResponse.json(
      { error: "目前無法驗證連線來源。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
  const limit = await checkPublicRateLimit({
    scope: "session-refresh",
    sourceIdentifier: ipHash,
    resourceIdentifier: stored.profileId,
    sourceLimit: 60,
    resourceLimit: 30,
    windowMs: 5 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Session 更新次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }
  const deviceId = resolveSessionDeviceId(request);
  const result = await rotateRequestSession(request, {
    deviceId,
    deviceLabel: getRequestDeviceLabel(request),
    ipHash,
    userAgentHash: hashClientUserAgent(request),
  });
  if (result.status !== "ROTATED") {
    const response = NextResponse.json(
      { error: "Session 已失效，請重新登入。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
    clearSessionCookies(response);
    await recordAuditEvent({
      action: result.status === "REUSED" ? "SESSION_REUSE_DETECTED" : "SESSION_REFRESH_FAILED",
      entityType: "AUTH_SESSION",
      outcome: "DENIED",
      requestId,
      actorProfileId: stored.profileId,
      ipHash,
    });
    return response;
  }

  const response = NextResponse.json(
    { ok: true, expiresAt: result.session.expiresAt.toISOString() },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  setSessionCookies(response, result.session, deviceId);
  await recordAuditEvent({
    action: "SESSION_REFRESHED",
    entityType: "AUTH_SESSION",
    entityId: result.session.id,
    outcome: "SUCCESS",
    requestId,
    actorProfileId: result.profileId,
    ipHash,
  });
  return response;
}
