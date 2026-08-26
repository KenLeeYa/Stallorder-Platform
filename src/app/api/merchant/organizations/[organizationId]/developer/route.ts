import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { developerCommandSchema } from "@/server/developer-platform/developer-contract";
import {
  applyDeveloperCommand,
  DeveloperPlatformError,
  getDeveloperPlatformDashboard,
} from "@/server/developer-platform/developer-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

function headers(requestId: string) {
  return { "cache-control": "no-store", "x-request-id": requestId };
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ORGANIZATION");
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      await getDeveloperPlatformDashboard(organizationId),
      { headers: headers(authorization.requestId) },
    );
  } catch (error) {
    return developerErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ORGANIZATION");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "DEVELOPER_PLATFORM",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: headers(authorization.requestId) },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = developerCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "開發者整合資料不正確，請檢查標示欄位。",
        fieldErrors: getZodFieldErrors(parsed.error, {
          name: "名稱",
          scopes: "API 權限範圍",
          stallIds: "攤位範圍",
          expiresAt: "到期時間",
          clientId: "API 金鑰",
          reason: "撤銷原因",
          url: "Webhook 網址",
          eventTypes: "Webhook 事件",
          endpointId: "Webhook 端點",
          status: "端點狀態",
        }),
      },
      { status: 400, headers: headers(authorization.requestId) },
    );
  }

  try {
    const result = await applyDeveloperCommand({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: `DEVELOPER_${parsed.data.operation}`,
      entityType: "DEVELOPER_PLATFORM",
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { operation: parsed.data.operation },
    });
    return NextResponse.json(
      {
        ...await getDeveloperPlatformDashboard(organizationId),
        oneTimeSecret: result.oneTimeSecret,
        secretKind: result.secretKind,
      },
      { headers: headers(authorization.requestId) },
    );
  } catch (error) {
    return developerErrorResponse(error, authorization.requestId);
  }
}

function developerErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof DeveloperPlatformError ? error.code : "DEVELOPER_PLATFORM_UPDATE_FAILED";
  const response = developerError(code);
  return NextResponse.json(
    { error: response.message },
    { status: response.status, headers: headers(requestId) },
  );
}

function developerError(code: string) {
  switch (code) {
    case "PUBLIC_API_MODULE_DISABLED":
      return { status: 403, message: "公開 API 模組尚未對此組織開放。" };
    case "PUBLIC_API_EXPIRY_INVALID":
      return { status: 400, message: "API 金鑰到期時間必須晚於目前時間。" };
    case "PUBLIC_API_STALL_SCOPE_INVALID":
      return { status: 400, message: "API 金鑰包含不屬於此組織的攤位。" };
    case "PUBLIC_API_CLIENT_NOT_FOUND":
    case "WEBHOOK_ENDPOINT_NOT_FOUND":
      return { status: 404, message: "找不到指定的 API 金鑰或 Webhook 端點。" };
    case "WEBHOOK_DESTINATION_UNSAFE":
      return { status: 400, message: "Webhook 網址無法通過公開 HTTPS 與 SSRF 安全驗證。" };
    case "DEVELOPER_DUPLICATE_RECORD":
      return { status: 409, message: "相同的開發者整合資料已存在。" };
    default:
      return { status: 500, message: "目前無法更新開發者整合設定。" };
  }
}
