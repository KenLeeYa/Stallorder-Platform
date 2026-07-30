import { NextResponse } from "next/server";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { resolveOfflineConflictSchema } from "@/offline/offline-contract";
import {
  listOfflineSyncConflicts,
  OfflineConflictOperationError,
  resolveOfflineSyncConflict,
} from "@/server/offline/offline-conflict-service";
import { offlineNoStoreHeaders } from "@/server/offline/offline-http";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL",
  );
  if (!authorization.ok) return authorization.response;

  return NextResponse.json({
    conflicts: await listOfflineSyncConflicts(authorization.workspace.id, stallId),
  }, {
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

  const body = await readJson(request, authorization.requestId, { maxBytes: 4_096 });
  if (body.error) return body.error;
  const parsed = resolveOfflineConflictSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "衝突處理資料格式不正確。" },
      { status: 400, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }

  try {
    const conflicts = await resolveOfflineSyncConflict({
      organizationId: authorization.workspace.id,
      stallId,
      command: parsed.data,
      actor: {
        profileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json({ conflicts }, {
      headers: offlineNoStoreHeaders(authorization.requestId),
    });
  } catch (error) {
    if (error instanceof OfflineConflictOperationError) {
      const notFound = error.code === "OFFLINE_CONFLICT_NOT_FOUND";
      return NextResponse.json(
        {
          error: notFound
            ? "找不到指定的同步衝突。"
            : "此同步衝突已由其他管理者完成處理。",
          code: error.code,
        },
        {
          status: notFound ? 404 : 409,
          headers: offlineNoStoreHeaders(authorization.requestId),
        },
      );
    }
    throw error;
  }
}
