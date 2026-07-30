import { NextResponse } from "next/server";
import {
  deliveryMenuMappingSchema,
  deliveryStallQuerySchema,
} from "@/lib/delivery-platform-contract";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import {
  authorizeMerchantDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
  validateDeliveryCsrf,
} from "@/server/delivery-platforms/delivery-http";
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "商品對應資料格式不正確。" },
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
