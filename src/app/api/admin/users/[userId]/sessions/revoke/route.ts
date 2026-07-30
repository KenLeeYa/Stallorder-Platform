import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestPrincipal, revokeAllProfileSessions } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp } from "@/lib/security";
import { assertIdentityAdminScope } from "@/server/auth/oauth/admin-authorization";

type RouteContext = { params: Promise<{ userId: string }> };

const revokeSchema = z.object({
  organizationId: z.string().uuid().optional(),
  reason: z.string().trim().min(5).max(120)
    .transform((value) => value.replace(/[\r\n]+/g, " ")),
}).strict();

export async function POST(request: Request, { params }: RouteContext) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal || !validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
  const body = await readJson(request, requestId, { maxBytes: 4096 });
  if (body.error) return body.error;
  const parsed = revokeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "撤銷 Session 資料格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
  const userId = (await params).userId;
  const limit = await checkRateLimit({
    scope: "oauth-admin-session-revoke",
    identifier: principal.user.id,
    limit: 30,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Session 撤銷操作過於頻繁。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  try {
    const scope = await assertIdentityAdminScope({
      principal,
      targetProfileId: userId,
      organizationId: parsed.data.organizationId,
    });
    const revoked = await revokeAllProfileSessions(userId, "ADMIN_REVOKED");
    await recordAuditEvent({
      organizationId: scope.organizationId ?? undefined,
      action: "SESSION_REVOKED",
      entityType: "PROFILE",
      entityId: userId,
      outcome: "SUCCESS",
      requestId,
      actorProfileId: principal.user.id,
      ipHash: hashClientIp(request),
      metadata: {
        reason: parsed.data.reason,
        revokedSessions: revoked.count,
      },
    });
    return NextResponse.json(
      { ok: true, revokedSessions: revoked.count },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    return NextResponse.json(
      { error: "找不到指定資源。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }
}
