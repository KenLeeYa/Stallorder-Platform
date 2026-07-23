import { NextResponse } from "next/server";
import { authorizePlatformAdminApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { merchantApplicationAdminCommandSchema } from "@/lib/merchant-application-contract";
import {
  approveMerchantApplication,
  MerchantApprovalError,
} from "@/server/merchant-applications/approve-merchant-application";
import {
  applyMerchantApplicationReviewAction,
  MerchantApplicationReviewError,
} from "@/server/merchant-applications/merchant-application-admin-service";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { applicationId } = await context.params;
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = merchantApplicationAdminCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "審核資料不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const audit = {
    actorProfileId: authorization.principal.user.id,
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  };
  try {
    const result = parsed.data.action === "APPROVE"
      ? await approveMerchantApplication(applicationId, {
          ...audit,
          internalReviewNote: parsed.data.internalReviewNote,
        })
      : await applyMerchantApplicationReviewAction(applicationId, parsed.data, audit);
    return NextResponse.json(
      { result },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const response = merchantApplicationAdminErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}

function merchantApplicationAdminErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof MerchantApprovalError || error instanceof MerchantApplicationReviewError
    ? error.code
    : null;
  if (!code) return null;
  const notFound = code === "APPLICATION_NOT_FOUND";
  const messages: Record<string, string> = {
    APPLICATION_NOT_FOUND: "找不到商家申請。",
    APPLICATION_STATE_CONFLICT: "申請狀態已變更，請重新整理後再操作。",
    APPLICANT_NOT_ELIGIBLE: "申請者帳號已停用或不再具備 Google 身分。",
    APPLICANT_ALREADY_ONBOARDED: "申請者已具有商家工作區權限，無法重複核准。",
    APPLICATION_INCOMPLETE: "申請資料或同意事項不完整，請先要求補件。",
    APPLICATION_RISK_BLOCKED: "申請已被標記為封鎖，必須先解除風險狀態。",
    SLUG_UNAVAILABLE: "申請的公開識別名稱已被使用，請先要求補件。",
    TRIAL_PLAN_NOT_AVAILABLE: "目前沒有可用的 Trial Plan Version。",
    PROVISIONING_CONFLICT: "商家建立發生唯一性衝突，未建立任何部分資料。",
    REVIEWER_NOT_AVAILABLE: "指定的審核人員不存在或已停用。",
  };
  return NextResponse.json(
    { error: messages[code] ?? "目前無法完成審核操作。", code },
    {
      status: notFound ? 404 : 409,
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    },
  );
}
