import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { supplyCommandSchema } from "@/server/supply-lite/supply-contract";
import {
  applySupplyCommand,
  getSupplyDashboard,
  SupplyOperationError,
} from "@/server/supply-lite/supply-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

function headers(requestId: string) {
  return { "cache-control": "no-store", "x-request-id": requestId };
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      await getSupplyDashboard(organizationId),
      { headers: headers(authorization.requestId) },
    );
  } catch (error) {
    return supplyErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "SUPPLY_LITE",
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
  const parsed = supplyCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "庫存資料不正確，請檢查標示欄位。",
        fieldErrors: getZodFieldErrors(parsed.error, {
          code: "原料代碼／庫位代碼",
          name: "原料名稱／庫位名稱",
          baseUom: "基本單位",
          lowStockThresholdMicros: "低庫存門檻",
          stallId: "攤位",
          locationType: "庫位類型",
          productId: "商品",
          ingredientId: "原料",
          locationId: "庫位",
          quantityMicros: "配方用量",
          quantityDeltaMicros: "庫存異動量",
          wasteBasisPoints: "耗損比例",
          unitCostMicros: "單位成本",
          sourceType: "來源類型",
          sourceId: "來源編號",
          idempotencyKey: "操作識別碼",
          reason: "異動原因",
        }),
      },
      { status: 400, headers: headers(authorization.requestId) },
    );
  }

  try {
    const result = await applySupplyCommand({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      command: parsed.data,
    });
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: `SUPPLY_${parsed.data.operation}`,
      entityType: "SUPPLY_LITE",
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: { operation: parsed.data.operation },
    });
    return NextResponse.json(
      await getSupplyDashboard(organizationId),
      { headers: headers(authorization.requestId) },
    );
  } catch (error) {
    return supplyErrorResponse(error, authorization.requestId);
  }
}

function supplyErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof SupplyOperationError ? error.code : "SUPPLY_UPDATE_FAILED";
  const response = supplyError(code);
  return NextResponse.json(
    { error: response.message },
    { status: response.status, headers: headers(requestId) },
  );
}

function supplyError(code: string) {
  switch (code) {
    case "SUPPLY_MODULE_DISABLED":
      return { status: 403, message: "Supply Lite 模組尚未對此組織開放。" };
    case "SUPPLY_INGREDIENT_NOT_FOUND":
    case "SUPPLY_LOCATION_NOT_FOUND":
    case "SUPPLY_PRODUCT_NOT_FOUND":
    case "SUPPLY_STALL_NOT_FOUND":
      return { status: 404, message: "找不到指定的原料、庫位、商品或攤位。" };
    case "SUPPLY_LOCATION_SCOPE_INVALID":
      return { status: 400, message: "只有攤位庫位可以指定攤位。" };
    case "SUPPLY_IDEMPOTENCY_CONFLICT":
      return { status: 409, message: "此庫存操作代碼已被其他內容使用，請重新送出。" };
    case "SUPPLY_DUPLICATE_RECORD":
      return { status: 409, message: "原料或庫位代碼已存在，請改用其他代碼。" };
    default:
      return { status: 500, message: "目前無法更新 Supply Lite 庫存。" };
  }
}
