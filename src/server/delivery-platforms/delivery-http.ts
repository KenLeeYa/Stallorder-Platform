import "server-only";

import { NextResponse } from "next/server";
import {
  authorizePlatformAdminApiRequest,
  authorizeStallManagementApiRequest,
} from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { EntitlementError, entitlementService } from "@/server/billing/entitlement-service";
import { resolveDeliveryFeatureState } from "./delivery-feature-flags";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type { DeliveryProvider } from "./delivery-platform-types";

export function deliveryNoStoreHeaders(requestId?: string) {
  return {
    "cache-control": "private, no-store, max-age=0",
    ...(requestId ? { "x-request-id": requestId } : {}),
  };
}

export async function authorizeMerchantDeliveryApi(
  request: Request,
  stallId: string,
  provider: DeliveryProvider = "UBER_EATS",
) {
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_DELIVERY_INTEGRATIONS",
  );
  if (!authorization.ok) return authorization;
  try {
    await entitlementService.assertFeatureEnabled(
      authorization.workspace.id,
      "DELIVERY_PLATFORM_INTEGRATIONS",
    );
    const state = await resolveDeliveryFeatureState(provider, {
      organizationId: authorization.workspace.id,
      stallId,
    });
    if (!state.foundation || !state.ui) {
      throw new DeliveryPlatformError("PROVIDER_DISABLED", { retryable: false });
    }
    return { ...authorization, featureState: state };
  } catch (error) {
    const response = deliveryApiErrorResponse(error, authorization.requestId);
    if (response) return { ok: false as const, response };
    throw error;
  }
}

export async function authorizePlatformDeliveryApi(request: Request, mutate = false) {
  const authorization = await authorizePlatformAdminApiRequest(request);
  if (!authorization.ok) return authorization;
  if (mutate && !validateCsrf(request, authorization.principal)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "安全驗證失敗，請重新整理後再試。" },
        { status: 403, headers: deliveryNoStoreHeaders(authorization.requestId) },
      ),
    };
  }
  return authorization;
}

export function deliveryApiErrorResponse(error: unknown, requestId?: string) {
  if (error instanceof EntitlementError) {
    return entitlementErrorResponse(error, requestId ?? "delivery");
  }
  if (!(error instanceof DeliveryPlatformError)) return null;
  const status = error.retryable
    ? 503
    : error.code === "CONNECTION_NOT_FOUND"
        || error.code === "STORE_NOT_FOUND"
        || error.code === "PROVIDER_RESOURCE_NOT_FOUND"
      ? 404
      : error.code === "PERMISSION_DENIED"
        ? 403
        : error.code === "INVALID_WEBHOOK"
          ? 401
          : 409;
  const messages: Record<DeliveryPlatformError["code"], string> = {
    BACKEND_NOT_WRITABLE: "主要資料庫目前無法寫入，請稍後再試。",
    CONNECTION_NOT_FOUND: "找不到外送平台連線。",
    CONNECTION_STATE_CONFLICT: "目前連線狀態不允許此操作。",
    DUPLICATE_EVENT: "此外送平台事件已處理。",
    INVALID_CREDENTIALS: "外送平台授權資料無效。",
    INVALID_WEBHOOK: "Webhook 驗證失敗。",
    MAPPING_REQUIRED: "請先完成外送門市、商品與註記對應。",
    PERMISSION_DENIED: "沒有權限執行此外送平台操作。",
    PROVIDER_DISABLED: "此外送平台功能目前尚未開放。",
    PROVIDER_CONTRACT_ERROR: "外送平台回傳資料格式不符合目前支援契約。",
    PROVIDER_NOT_APPROVED: "尚未完成外送平台合作或授權審核。",
    PROVIDER_RESOURCE_NOT_FOUND: "外送平台找不到指定資料。",
    PROVIDER_TIMEOUT: "外送平台回應逾時，系統將依規則重試。",
    PROVIDER_UNAVAILABLE: "外送平台暫時無法使用，請稍後再試。",
    RETRYABLE_PROVIDER_ERROR: "外送平台暫時無法完成操作，系統將依規則重試。",
    STORE_NOT_FOUND: "找不到已授權的外送門市。",
    UNSUPPORTED_MAPPING: "外送平台對應資料不完整或格式不支援。",
  };
  return NextResponse.json(
    { error: messages[error.code], code: error.code },
    { status, headers: deliveryNoStoreHeaders(requestId) },
  );
}

export function validateDeliveryCsrf(
  request: Request,
  authorization: {
    principal: Parameters<typeof validateCsrf>[1];
    requestId: string;
  },
) {
  if (validateCsrf(request, authorization.principal)) return null;
  return NextResponse.json(
    { error: "安全驗證失敗，請重新整理後再試。" },
    { status: 403, headers: deliveryNoStoreHeaders(authorization.requestId) },
  );
}
