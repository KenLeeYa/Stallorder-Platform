import { NextResponse } from "next/server";
import { offlineManagementCommandSchema } from "@/offline/offline-contract";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import {
  applyOfflineManagementCommand,
  getOfflineManagementState,
} from "@/server/offline/offline-device-service";
import { offlineErrorResponse, offlineNoStoreHeaders } from "@/server/offline/offline-http";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL",
  );
  if (!authorization.ok) return authorization.response;

  const data = await getOfflineManagementState(authorization.workspace.id, stallId);
  return NextResponse.json(data, {
    headers: offlineNoStoreHeaders(authorization.requestId),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "CSRF 驗證失敗，請重新整理頁面後再試。" },
      { status: 403, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = offlineManagementCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "離線政策資料格式不正確。" },
      { status: 400, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }

  try {
    const data = await applyOfflineManagementCommand({
      organizationId: authorization.workspace.id,
      stallId,
      command: parsed.data,
      actor: {
        profileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(data, {
      headers: offlineNoStoreHeaders(authorization.requestId),
    });
  } catch (error) {
    const response = offlineErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
