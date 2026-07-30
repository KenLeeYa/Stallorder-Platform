import { NextResponse } from "next/server";
import { offlineSyncRequestSchema } from "@/offline/offline-order-contract";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import {
  offlineErrorResponse,
  offlineNoStoreHeaders,
} from "@/server/offline/offline-http";
import { importOfflineSyncBatch } from "@/server/offline/offline-sync-service";

function stallSlugFromRequest(request: Request) {
  const value = request.headers.get("x-stall-slug")?.trim() ?? "";
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const stallSlug = stallSlugFromRequest(request);
  if (!stallSlug) {
    return NextResponse.json(
      { error: "缺少有效的攤位識別。" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const authorization = await authorizeApiRequest(request, stallSlug, "CREATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 512_000 });
  if (body.error) return body.error;
  const parsed = offlineSyncRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "離線同步資料格式不正確。" },
      { status: 400, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }
  const ipHash = hashClientIp(request);
  const [deviceLimit, ipLimit] = await Promise.all([
    checkRateLimit({
      scope: "offline-sync-device",
      identifier: `${authorization.principal.user.id}:${parsed.data.installationId}`,
      limit: 120,
      windowMs: 5 * 60_000,
    }),
    checkRateLimit({
      scope: "offline-sync-ip",
      identifier: ipHash,
      limit: 240,
      windowMs: 5 * 60_000,
    }),
  ]);
  const limited = [deviceLimit, ipLimit].find((result) => !result.allowed);
  if (limited) {
    return NextResponse.json(
      { error: "同步操作過於頻繁，請稍後再試。" },
      {
        status: 429,
        headers: {
          ...offlineNoStoreHeaders(authorization.requestId),
          "retry-after": String(limited.retryAfterSeconds),
        },
      },
    );
  }
  try {
    const result = await importOfflineSyncBatch({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      installationId: parsed.data.installationId,
      permitToken: parsed.data.permitToken,
      clientSentAt: parsed.data.clientSentAt,
      records: parsed.data.records,
      actor: {
        profileId: authorization.principal.user.id,
        roles: authorization.roles,
        requestId: authorization.requestId,
        ipHash,
      },
    });
    return NextResponse.json(result, {
      headers: offlineNoStoreHeaders(authorization.requestId),
    });
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const offlineResponse = offlineErrorResponse(error, authorization.requestId);
    if (offlineResponse) return offlineResponse;
    throw error;
  }
}
