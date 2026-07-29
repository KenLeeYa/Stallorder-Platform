import { NextResponse } from "next/server";
import {
  clearSessionCookies,
  getRequestPrincipal,
  revokeAllProfileSessions,
} from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { createRequestId, hashClientIp } from "@/lib/security";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal || !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "無法驗證全部登出請求。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  const revoked = await revokeAllProfileSessions(principal.user.id, "LOGOUT_ALL");
  const response = NextResponse.json(
    { ok: true, revokedSessions: revoked.count },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
  clearSessionCookies(response);
  await recordAuditEvent({
    action: "LOGOUT_ALL",
    entityType: "AUTH_SESSION",
    outcome: "SUCCESS",
    requestId,
    actorProfileId: principal.user.id,
    ipHash: hashClientIp(request),
    metadata: { revokedSessions: revoked.count },
  });
  return response;
}
