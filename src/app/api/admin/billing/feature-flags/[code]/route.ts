import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import {
  adminMutableBillingFeatureFlagCodes,
  setBillingFeatureFlag,
  type AdminMutableBillingFeatureFlagCode,
} from "@/server/billing/billing-feature-flag-admin";
import { billingFeatureFlagUpdateSchema } from "@/server/billing/billing-validation";

const knownCodes = new Set<string>(adminMutableBillingFeatureFlagCodes);

const transitionErrors: Record<string, string> = {
  BILLING_FEATURE_FLAG_NOT_FOUND: "找不到指定的帳務開關。請先套用最新本機資料庫 migration。",
  PAYG_OPEN_BETA_STILL_ENABLED: "仍在開放測試免費模式，不能啟用自動關帳。",
  PAYG_BILLING_NOT_ENABLED: "請先啟用 PAYG 計費核心，再啟用這個階段。",
  PAYG_REFUND_CREDITS_NOT_ENABLED: "請先啟用完整退款折抵，避免帳單多收。",
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const { code } = await context.params;
  if (!knownCodes.has(code)) {
    return NextResponse.json(
      { error: "找不到指定的帳務開關。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = billingFeatureFlagUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "開關設定格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const flag = await setBillingFeatureFlag(
      code as AdminMutableBillingFeatureFlagCode,
      parsed.data,
      {
        profileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    );
    return NextResponse.json(
      { flag },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { error: transitionErrors[errorCode] ?? "目前無法更新帳務開關。" },
      { status: transitionErrors[errorCode] ? 409 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
