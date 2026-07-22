import { NextResponse } from "next/server";
import { logEvent, recordAuditEvent } from "@/lib/audit";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { lineIntegrationCommandSchema } from "@/lib/line-notification-contract";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import {
  disableLineIntegration,
  getLineIntegrationManagerData,
  upsertLineIntegration,
} from "@/server/notifications/line-integration-service";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_LINE_INTEGRATION",
  );
  if (!authorization.ok) return authorization.response;
  try {
    const data = await getLineIntegrationManagerData(authorization.workspace.id, stallId);
    return NextResponse.json(data, { headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    logEvent("error", "LINE_INTEGRATION_READ_FAILED", {
      requestId: authorization.requestId,
      stallId,
    });
    return NextResponse.json(
      { error: "目前無法讀取 LINE 整合設定。" },
      { status: 500, headers: noStoreHeaders(authorization.requestId) },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_LINE_INTEGRATION",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type 必須是 application/json。" },
      { status: 415, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = lineIntegrationCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "LINE 整合設定不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    if (parsed.data.operation === "UPSERT") {
      await upsertLineIntegration({
        organizationId: authorization.workspace.id,
        stallId,
        channelId: parsed.data.channelId,
        channelAccessToken: parsed.data.channelAccessToken,
        messagingChannelSecret: parsed.data.messagingChannelSecret,
        loginChannelSecret: parsed.data.loginChannelSecret,
        settings: {
          displayName: parsed.data.displayName,
          officialAccountUrl: parsed.data.officialAccountUrl,
          notifyConfirmed: parsed.data.notifyConfirmed,
          notifyReady: parsed.data.notifyReady,
          notifyCancelled: parsed.data.notifyCancelled,
        },
      });
      await recordAuditEvent({
        organizationId: authorization.workspace.id,
        stallId,
        actorProfileId: authorization.principal.user.id,
        action: "LINE_INTEGRATION_CONFIGURED",
        entityType: "NOTIFICATION_INTEGRATION",
        entityId: stallId,
        outcome: "SUCCESS",
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
        metadata: {
          notifyConfirmed: parsed.data.notifyConfirmed,
          notifyReady: parsed.data.notifyReady,
          notifyCancelled: parsed.data.notifyCancelled,
          credentialsRotated: true,
        },
      });
    } else {
      await disableLineIntegration(authorization.workspace.id, stallId);
      await recordAuditEvent({
        organizationId: authorization.workspace.id,
        stallId,
        actorProfileId: authorization.principal.user.id,
        action: "LINE_INTEGRATION_DISABLED",
        entityType: "NOTIFICATION_INTEGRATION",
        entityId: stallId,
        outcome: "SUCCESS",
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
        metadata: { reason: parsed.data.reason },
      });
    }
    const data = await getLineIntegrationManagerData(authorization.workspace.id, stallId);
    return NextResponse.json(data, { headers: noStoreHeaders(authorization.requestId) });
  } catch (error) {
    const response = entitlementErrorResponse(error, authorization.requestId);
    if (response) return response;
    logEvent("error", "LINE_INTEGRATION_UPDATE_FAILED", {
      requestId: authorization.requestId,
      stallId,
    });
    return NextResponse.json(
      { error: "目前無法更新 LINE 整合設定。" },
      { status: 500, headers: noStoreHeaders(authorization.requestId) },
    );
  }
}

function noStoreHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}
