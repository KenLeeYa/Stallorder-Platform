import { NextResponse } from "next/server";
import {
  clearSessionCookies,
  getRequestPrincipal,
} from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { createRequestId, hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal || !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const { sessionId } = await context.params;
  const revoked = await prisma.authSession.updateMany({
    where: {
      id: sessionId,
      profileId: principal.user.id,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokeReason: sessionId === principal.sessionId
        ? "SECURITY_SCREEN_LOGOUT"
        : "DEVICE_REVOKED",
    },
  });
  if (revoked.count !== 1) {
    return NextResponse.json(
      { error: "找不到可登出的裝置工作階段。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  await recordAuditEvent({
    action: "AUTH_SESSION_REVOKED",
    entityType: "AUTH_SESSION",
    entityId: sessionId,
    outcome: "SUCCESS",
    requestId,
    actorProfileId: principal.user.id,
    ipHash: hashClientIp(request),
    metadata: { currentSession: sessionId === principal.sessionId },
  });
  const response = NextResponse.json(
    { ok: true, currentSession: sessionId === principal.sessionId },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  if (sessionId === principal.sessionId) clearSessionCookies(response);
  return response;
}
