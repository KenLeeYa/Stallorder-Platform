import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  deliveryMenuMappingSchema,
  deliveryStallQuerySchema,
} from "@/lib/delivery-platform-contract";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import {
  authorizeMerchantDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
  validateDeliveryCsrf,
} from "@/server/delivery-platforms/delivery-http";
import { DeliveryPlatformError } from "@/server/delivery-platforms/delivery-platform-errors";
import {
  listExternalMenuMappings,
  upsertExternalMenuMapping,
} from "@/server/delivery-platforms/menu-mapping-service";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const scope = await resolveScope(request, context);
  if (!scope.ok) return scope.response;
  const mappings = await listExternalMenuMappings(scope.connection.id);
  return NextResponse.json(
    { mappings },
    { headers: deliveryNoStoreHeaders(scope.authorization.requestId) },
  );
}

export async function PUT(request: Request, context: RouteContext) {
  const scope = await resolveScope(request, context);
  if (!scope.ok) return scope.response;
  const csrfError = validateDeliveryCsrf(request, scope.authorization);
  if (csrfError) return csrfError;
  const body = await readJson(request, scope.authorization.requestId, { maxBytes: 8_000 });
  if (body.error) return body.error;
  const parsed = deliveryMenuMappingSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getZodFieldErrors(parsed.error, {
      internalEntityType: "資料類型",
      internalEntityId: "攤點通項目",
      externalEntityId: "外送平台項目 ID",
      externalParentId: "外送平台上層 ID",
    });
    return NextResponse.json(
      { error: "商品對應資料格式不正確，請檢查標示欄位。", fieldErrors },
      { status: 400, headers: deliveryNoStoreHeaders(scope.authorization.requestId) },
    );
  }
  try {
    const mapping = await upsertExternalMenuMapping({
      organizationId: scope.authorization.workspace.id,
      stallId: scope.stallId,
      connectionId: scope.connection.id,
      ...parsed.data,
      actorProfileId: scope.authorization.principal.user.id,
      requestId: scope.authorization.requestId,
      ipHash: hashClientIp(request),
      circuit: "CIRCUIT_B_VERCEL",
    });
    return NextResponse.json(
      { mapping },
      { headers: deliveryNoStoreHeaders(scope.authorization.requestId) },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = JSON.stringify(error.meta?.target ?? "").toLowerCase();
      const field = target.includes("internal_entity_id") || target.includes("internalentityid") || target.includes("_internal_key")
        ? "internalEntityId"
        : target.includes("external_entity_id") || target.includes("externalentityid") || target.includes("_external_key")
          ? "externalEntityId"
          : null;
      if (!field) {
        return NextResponse.json(
          { error: "目前無法儲存商品對應。" },
          { status: 500, headers: deliveryNoStoreHeaders(scope.authorization.requestId) },
        );
      }
      const message = field === "internalEntityId"
        ? "此攤點通項目已建立對應，請重新整理後再試。"
        : "此外送平台項目 ID 已對應其他攤點通項目。";
      return NextResponse.json(
        { error: message, fieldErrors: { [field]: message } },
        { status: 409, headers: deliveryNoStoreHeaders(scope.authorization.requestId) },
      );
    }
    if (error instanceof DeliveryPlatformError && error.code === "UNSUPPORTED_MAPPING") {
      const message = "找不到所選的攤點通項目，請重新選擇。";
      return NextResponse.json(
        { error: message, code: error.code, fieldErrors: { internalEntityId: message } },
        { status: 409, headers: deliveryNoStoreHeaders(scope.authorization.requestId) },
      );
    }
    const response = deliveryApiErrorResponse(error, scope.authorization.requestId);
    if (response) return response;
    throw error;
  }
}

async function resolveScope(request: Request, context: RouteContext) {
  const { connectionId } = await context.params;
  const query = deliveryStallQuerySchema.safeParse({
    stallId: new URL(request.url).searchParams.get("stallId"),
  });
  if (!query.success) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "攤位參數格式不正確。" }, { status: 400 }),
    };
  }
  const authorization = await authorizeMerchantDeliveryApi(request, query.data.stallId);
  if (!authorization.ok) return authorization;
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    authorization.workspace.id,
    query.data.stallId,
  );
  if (!connection) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "找不到外送平台連線。" },
        { status: 404, headers: deliveryNoStoreHeaders(authorization.requestId) },
      ),
    };
  }
  return { ok: true as const, authorization, connection, stallId: query.data.stallId };
}
