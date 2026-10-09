import "server-only";
import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { pickupLookupSchema, pickupManageSchema, pickupRedeemSchema } from "./pickup-contract";
import { PickupError, requirePickupRuntime, previewPlatformPickup, redeemPlatformPickup, managePlatformPickup } from "./pickup-service";

export const pickupPrivateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const messages: Record<string, string> = {
  PICKUP_DISABLED: "平台取餐服務目前停用，請聯絡平台管理員協助處理既有訂單。",
  PICKUP_NOT_FOUND: "找不到此店可核對的取餐憑證，請確認店家與取餐資料。",
  PICKUP_ORDER_UNAVAILABLE: "訂單已取消、逾期或退款，無法交付。",
  PICKUP_REVOKED: "此取餐憑證已撤銷或取餐時間已更改，請使用新版 QR。",
  PICKUP_EXPIRED: "取餐憑證已過期，請核對訂單後由店員重新發行。",
  PICKUP_VERSION_CONFLICT: "訂單或憑證已更新，請重新預覽。",
  PICKUP_IDEMPOTENCY_CONFLICT: "此操作已用於其他交付資料，請重新預覽。",
  PICKUP_PAYMENT_REQUIRED: "此訂單尚未結清，請先沿原收款流程確認付款。",
  PICKUP_NOT_READY: "餐點尚未完成，或付款／退款仍待確認，暫時無法交付。",
  PICKUP_ALREADY_REDEEMED: "此訂單已完成交付，無法重新發行憑證。",
  PICKUP_DEADLINE_INVALID: "請設定未來且在允許寬限內的到期時間。",
};
export function pickupErrorResponse(error: unknown) {
  if (error instanceof PickupError) return NextResponse.json({ code: error.code, error: messages[error.code] ?? "無法處理取餐操作。" },
    { status: error.status, headers: pickupPrivateHeaders });
  return NextResponse.json({ code: "PICKUP_UNAVAILABLE", error: "交付結果尚未確認，請重新預覽訂單後再操作。" },
    { status: 503, headers: pickupPrivateHeaders });
}

export async function handlePickupStaffCommand(request: Request, stallSlug: string, operation: "preview" | "redeem" | "manage") {
  const authorization = await authorizeApiRequest(request, stallSlug, "CHECKOUT_ORDERS");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) return NextResponse.json({ error: "安全驗證已失效，請重新整理後再試。" },
    { status: 403, headers: pickupPrivateHeaders });
  try {
    requirePickupRuntime();
    const rate = await checkRateLimit({ scope: `line-platform-pickup-${operation}`,
      identifier: `${authorization.principal.user.id}:${authorization.stall.id}`, limit: operation === "preview" ? 20 : 10, windowMs: 60_000 });
    if (!rate.allowed) return NextResponse.json({ error: "操作過於頻繁，請稍後再試。" },
      { status: 429, headers: { ...pickupPrivateHeaders, "Retry-After": String(rate.retryAfterSeconds) } });
    const body = await readJson(request, authorization.requestId);
    if (body.error) return body.error;
    let result;
    if (operation === "preview") {
      const parsed = pickupLookupSchema.safeParse(body.data);
      if (!parsed.success) throw new PickupError("PICKUP_INPUT_INVALID", 400);
      result = await previewPlatformPickup(authorization.stall.id, parsed.data);
    } else if (operation === "redeem") {
      const parsed = pickupRedeemSchema.safeParse(body.data);
      if (!parsed.success) throw new PickupError("PICKUP_INPUT_INVALID", 400);
      result = await redeemPlatformPickup(authorization.stall.id, authorization.principal.user.id, parsed.data);
    } else {
      const parsed = pickupManageSchema.safeParse(body.data);
      if (!parsed.success) throw new PickupError("PICKUP_INPUT_INVALID", 400);
      result = await managePlatformPickup(authorization.stall.id, authorization.principal.user.id, parsed.data);
    }
    return NextResponse.json(result, { headers: pickupPrivateHeaders });
  } catch (error) {
    await recordAuditEvent({ action: "LINE_PLATFORM_PICKUP_REJECTED", entityType: "ORDER", outcome: "DENIED",
      organizationId: authorization.stall.organizationId, stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id, requestId: authorization.requestId,
      metadata: { operation, code: error instanceof PickupError ? error.code : "PICKUP_UNAVAILABLE" } });
    return pickupErrorResponse(error);
  }
}
