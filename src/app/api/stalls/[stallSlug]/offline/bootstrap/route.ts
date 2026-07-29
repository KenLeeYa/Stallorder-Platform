import { NextResponse } from "next/server";
import { offlineBootstrapSchema } from "@/offline/offline-contract";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { issueOfflineBootstrap } from "@/server/offline/offline-device-service";
import { offlineErrorResponse, offlineNoStoreHeaders } from "@/server/offline/offline-http";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "CREATE_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "CSRF 驗證失敗，請重新整理頁面後再試。" },
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
