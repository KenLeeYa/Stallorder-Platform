import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { growthCommandSchema } from "@/server/growth/growth-contract";
import {
  applyGrowthCommand,
  getGrowthDashboard,
  GrowthOperationError,
} from "@/server/growth/growth-service";

type RouteContext = { params: Promise<{ organizationId: string }> };
const headers = (requestId: string) => ({ "cache-control": "no-store", "x-request-id": requestId });

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ORGANIZATION");
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(await getGrowthDashboard(organizationId), { headers: headers(authorization.requestId) });
  } catch (error) {
    return growthErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_ORGANIZATION");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({ organizationId, actorProfileId: authorization.principal.user.id, action: "CSRF_VALIDATION_FAILED", entityType: "GROWTH", outcome: "DENIED", requestId: authorization.requestId, ipHash: hashClientIp(request) });
    return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" }, { status: 403, headers: headers(authorization.requestId) });
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = growthCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "優惠活動資料不正確，請檢查標示欄位。", fieldErrors: getZodFieldErrors(parsed.error, { name: "活動名稱", discountType: "折扣類型", discountValue: "折扣值", budgetAmount: "活動預算", perCustomerLimit: "每客上限", minimumOrderAmount: "最低消費", startsAt: "開始時間", endsAt: "結束時間", channels: "適用通路", campaignId: "優惠活動", status: "活動狀態" }) }, { status: 400, headers: headers(authorization.requestId) });
  }
  try {
    const result = await applyGrowthCommand({ organizationId, actorProfileId: authorization.principal.user.id, command: parsed.data });
    await recordAuditEvent({ organizationId, actorProfileId: authorization.principal.user.id, action: `GROWTH_${parsed.data.operation}`, entityType: "GROWTH_COUPON_CAMPAIGN", entityId: result.id, outcome: "SUCCESS", requestId: authorization.requestId, ipHash: hashClientIp(request), metadata: { operation: parsed.data.operation } });
    return NextResponse.json(await getGrowthDashboard(organizationId), { headers: headers(authorization.requestId) });
  } catch (error) {
    return growthErrorResponse(error, authorization.requestId);
  }
}

function growthErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof GrowthOperationError ? error.code : "GROWTH_UPDATE_FAILED";
  const response = code === "GROWTH_MODULE_DISABLED"
    ? { status: 403, message: "會員與成長模組尚未對此組織開放。" }
    : code === "GROWTH_CAMPAIGN_NOT_FOUND"
      ? { status: 404, message: "找不到指定的優惠活動。" }
      : code === "GROWTH_CAMPAIGN_TRANSITION_INVALID"
        ? { status: 409, message: "此優惠活動目前不能切換到指定狀態。" }
        : { status: 500, message: "目前無法更新會員與成長設定。" };
  return NextResponse.json({ error: response.message }, { status: response.status, headers: headers(requestId) });
}
