import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { merchantSetupCommandSchema } from "@/lib/merchant-setup-contract";
import { hashClientIp } from "@/lib/security";
import {
  activateMerchantGoLive,
  completeMerchantSetupStep,
  createMerchantSetupTestOrder,
  MerchantSetupError,
} from "@/server/merchant-applications/merchant-setup-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(request, organizationId, "MANAGE_SUBSCRIPTION");
  if (!authorization.ok) return authorization.response;
  const isOwner = authorization.workspace.roles.includes("ORGANIZATION_OWNER");
  if (!isOwner) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "MERCHANT_SETUP_AUTHORIZATION_DENIED",
      entityType: "MERCHANT_SETUP_PROGRESS",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "只有組織擁有者可以完成開店設定。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = merchantSetupCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "開店設定操作不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const audit = {
    actorProfileId: authorization.principal.user.id,
    actorRoles: authorization.workspace.roles,
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  };
  try {
    const result = parsed.data.action === "COMPLETE_STEP"
      ? await completeMerchantSetupStep(organizationId, parsed.data.step, audit)
      : parsed.data.action === "CREATE_TEST_ORDER"
        ? await createMerchantSetupTestOrder(organizationId, audit)
        : await activateMerchantGoLive(organizationId, audit);
    return NextResponse.json(
      { result },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    if (error instanceof MerchantSetupError) {
      const messages: Record<MerchantSetupError["code"], string> = {
        SETUP_NOT_FOUND: "找不到此組織的開店設定。",
        SETUP_ALREADY_LIVE: "此攤位已完成正式開放。",
        SETUP_STEP_NOT_READY: "此步驟的必要資料尚未完成。",
        SETUP_PREREQUISITES_INCOMPLETE: "請先完成前六個設定步驟。",
        TEST_PRODUCT_NOT_AVAILABLE: "目前沒有可用商品可建立測試訂單。",
        TEST_ORDER_NOT_COMPLETED: "測試訂單尚未由店員完整處理至完成。",
        SUBSCRIPTION_NOT_ACTIVE: "Trial 或訂閱目前不可用，無法開放接單。",
        QR_NOT_PAUSED: "QR 狀態不是可開放的暫停狀態。",
        GO_LIVE_STATE_CONFLICT: "攤位營運狀態已變更，請重新整理後確認。",
      };
      return NextResponse.json(
        { error: messages[error.code], code: error.code },
        {
          status: error.code === "SETUP_NOT_FOUND" ? 404 : 409,
          headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
        },
      );
    }
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "MERCHANT_SETUP_OPERATION_FAILED",
      entityType: "MERCHANT_SETUP_PROGRESS",
      outcome: "FAILURE",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "目前無法完成開店設定，請稍後再試。" },
      { status: 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
