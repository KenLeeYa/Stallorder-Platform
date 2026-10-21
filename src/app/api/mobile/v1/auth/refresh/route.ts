import { NextResponse } from "next/server";
import { mobileSessionRefreshResponseSchema } from "@stallorder/contracts/mobile/v1";
import {
  getMobileBearerToken,
  getMobileRefreshProfileId,
  getMobileSessionDeviceId,
  rotateSessionToken,
} from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, hashClientUserAgent } from "@/lib/security";
import { resolveMobileFeatureState } from "@/server/mobile/feature-flags";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const profileId = await getMobileRefreshProfileId(request);
  const featureFlags = await resolveMobileFeatureState(profileId ?? undefined);
  if (!featureFlags.mobileApp) {
    return NextResponse.json(
      { code: "MOBILE_NOT_ENABLED", message: "Mobile 功能尚未開放。", requestId },
      { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const token = getMobileBearerToken(request);
  const deviceId = getMobileSessionDeviceId(request);
  if (!token || !deviceId) {
    return NextResponse.json(
      { code: "AUTHENTICATION_REQUIRED", message: "請先登入。", requestId },
      { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  let ipHash: string;
  try {
    ipHash = hashClientIp(request);
  } catch {
    return NextResponse.json(
      { code: "CONNECTION_EVIDENCE_UNAVAILABLE", message: "目前無法驗證連線來源。", requestId },
      { status: 503, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const limit = await checkRateLimit({
    scope: "mobile-session-refresh-ip",
    identifier: ipHash,
    limit: 60,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", message: "Session 更新過於頻繁，請稍後再試。", requestId },
      {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  const result = await rotateSessionToken(token, {
    deviceId,
    ipHash,
    userAgentHash: hashClientUserAgent(request),
  });
  if (result.status !== "ROTATED") {
    await recordAuditEvent({
      action: result.status === "REUSED" ? "SESSION_REUSE_DETECTED" : "SESSION_REFRESH_FAILED",
      entityType: "AUTH_SESSION",
      outcome: "DENIED",
      requestId,
      ipHash,
      metadata: { client: "mobile-v1" },
    });
    return NextResponse.json(
      { code: "SESSION_EXPIRED", message: "Session 已失效，請重新登入。", requestId },
      { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }

  const response = mobileSessionRefreshResponseSchema.parse({
    version: "v1",
    session: { token: result.session.token, expiresAt: result.session.expiresAt.toISOString() },
  });
  await recordAuditEvent({
    action: "SESSION_REFRESHED",
    entityType: "AUTH_SESSION",
    entityId: result.session.id,
    outcome: "SUCCESS",
    requestId,
    actorProfileId: result.profileId,
    ipHash,
    metadata: { client: "mobile-v1" },
  });
  return NextResponse.json(response, {
    headers: { "cache-control": "private, no-store", "x-request-id": requestId },
  });
}
