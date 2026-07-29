import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeApiRequest } from "@/lib/authorization";
import {
  offlineErrorResponse,
  offlineNoStoreHeaders,
} from "@/server/offline/offline-http";
import { getOfflineSyncStatus } from "@/server/offline/offline-sync-service";

const querySchema = z.object({
  installationId: z.string().uuid(),
}).strict();

function stallSlugFromRequest(request: Request) {
  const value = request.headers.get("x-stall-slug")?.trim() ?? "";
  return /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(value) ? value : null;
}

export async function GET(request: Request) {
  const stallSlug = stallSlugFromRequest(request);
  if (!stallSlug) {
    return NextResponse.json(
      { error: "缺少有效的攤位識別。" },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!authorization.ok) return authorization.response;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    installationId: url.searchParams.get("installationId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "裝置識別格式不正確。" },
      { status: 400, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const result = await getOfflineSyncStatus({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      installationId: parsed.data.installationId,
      profileId: authorization.principal.user.id,
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
