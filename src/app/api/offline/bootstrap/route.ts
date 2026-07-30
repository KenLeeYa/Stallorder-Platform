import { NextResponse } from "next/server";
import { offlineBootstrapSchema } from "@/offline/offline-contract";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { issueOfflineBootstrap } from "@/server/offline/offline-device-service";
import {
  offlineErrorResponse,
  offlineNoStoreHeaders,
} from "@/server/offline/offline-http";

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
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = offlineBootstrapSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "離線啟用資料格式不正確。" },
      { status: 400, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const result = await issueOfflineBootstrap({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      profileId: authorization.principal.user.id,
      roles: authorization.roles,
      command: parsed.data,
      actor: {
        profileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(result, {
      headers: offlineNoStoreHeaders(authorization.requestId),
    });
  } catch (error) {
    const response = offlineErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
