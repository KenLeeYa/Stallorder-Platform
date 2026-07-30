import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import {
  resilienceFeatureFlagCodes,
  resilienceFlagOverrideCommandSchema,
  setResilienceFeatureFlagOverride,
  type ResilienceFeatureFlagCode,
} from "@/server/resilience/feature-flag-service";

const knownCodes = new Set<string>(resilienceFeatureFlagCodes);

const errorMessages: Record<string, string> = {
  RESILIENCE_FLAG_NOT_FOUND: "找不到指定的韌性功能旗標。",
  RESILIENCE_FLAG_ORGANIZATION_NOT_FOUND: "找不到指定組織。",
  RESILIENCE_FLAG_STALL_SCOPE_MISMATCH: "攤位不屬於指定組織。",
  RESILIENCE_FUTURE_FLAG_LOCKED: "現場 Gateway 仍屬未來功能，目前不得啟用。",
  RESILIENCE_FLAG_EXPIRY_NOT_FUTURE: "到期時間必須晚於目前時間。",
  RESILIENCE_EMERGENCY_EXPIRY_REQUIRED: "緊急旗標必須設定自動到期時間。",
  RESILIENCE_EMERGENCY_EXPIRY_TOO_LONG: "緊急旗標最長只能啟用 24 小時。",
  OAUTH_MIGRATION_GATE_BLOCKED: "仍有高權限或密碼帳號尚未完成 OAuth 綁定，不得啟用 OAuth-only 登入。",
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "CSRF 驗證失敗，請重新整理頁面後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const { code } = await context.params;
  if (!knownCodes.has(code)) {
    return NextResponse.json(
      { error: "找不到指定的韌性功能旗標。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = resilienceFlagOverrideCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "旗標設定格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const override = await setResilienceFeatureFlagOverride(
      code as ResilienceFeatureFlagCode,
      parsed.data,
      {
        profileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    );
    return NextResponse.json(
      { override },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": authorization.requestId,
        },
      },
    );
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "";
    const message = errorMessages[errorCode];
    return NextResponse.json(
      { error: message ?? "目前無法更新韌性功能旗標。" },
      {
        status: message ? 400 : 500,
        headers: { "x-request-id": authorization.requestId },
      },
    );
  }
}
