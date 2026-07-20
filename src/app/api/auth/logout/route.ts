import { NextResponse } from "next/server";
import { clearSessionCookies, getRequestPrincipal, revokeRequestSession } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { createRequestId, hashClientIp } from "@/lib/security";
import { createSupabaseAuthClient, isSupabaseAuthConfigured } from "@/lib/supabase-auth";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal || !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "無法驗證登出請求。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  await revokeRequestSession(request);
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseAuthClient();
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        "cache-control": "no-store",
        "clear-site-data": '"cache"',
        "x-request-id": requestId,
      },
    },
  );
  clearSessionCookies(response);
  await recordAuditEvent({
    action: "LOGOUT",
    entityType: "AUTH",
    outcome: "SUCCESS",
    requestId,
    actorProfileId: principal.user.id,
    ipHash: hashClientIp(request),
  });
  return response;
}
