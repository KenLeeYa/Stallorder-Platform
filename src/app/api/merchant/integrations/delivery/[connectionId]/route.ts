import { NextResponse } from "next/server";
import {
  deliveryConnectionCommandSchema,
  deliveryStallQuerySchema,
} from "@/lib/delivery-platform-contract";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { setDeliveryConnectionStatus } from "@/server/delivery-platforms/connection-service";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import {
  authorizeMerchantDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
  validateDeliveryCsrf,
} from "@/server/delivery-platforms/delivery-http";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { connectionId } = await context.params;
  const query = parseStallQuery(request);
  if (!query.success) return query.response;
  const authorization = await authorizeMerchantDeliveryApi(request, query.stallId);
  if (!authorization.ok) return authorization.response;
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    authorization.workspace.id,
    query.stallId,
  );
  if (!connection) {
    return NextResponse.json(
      { error: "找不到外送平台連線。" },
      { status: 404, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  return NextResponse.json(
    { connection },
    { headers: deliveryNoStoreHeaders(authorization.requestId) },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { connectionId } = await context.params;
  const query = parseStallQuery(request);
  if (!query.success) return query.response;
  const authorization = await authorizeMerchantDeliveryApi(request, query.stallId);
  if (!authorization.ok) return authorization.response;
  const csrfError = validateDeliveryCsrf(request, authorization);
  if (csrfError) return csrfError;
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    authorization.workspace.id,
    query.stallId,
  );
  if (!connection) {
    return NextResponse.json(
      { error: "找不到外送平台連線。" },
      { status: 404, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  const body = await readJson(request, authorization.requestId, { maxBytes: 4_000 });
  if (body.error) return body.error;
  const parsed = deliveryConnectionCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "連線操作格式不正確。" },
      { status: 400, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const updated = await setDeliveryConnectionStatus({
      connectionId,
      nextStatus: parsed.data.action === "PAUSE" ? "PAUSED" : "DISCONNECTED",
      audit: {
        actorProfileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(
      { connection: updated },
      { headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const response = deliveryApiErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}

function parseStallQuery(request: Request) {
  const parsed = deliveryStallQuerySchema.safeParse({
    stallId: new URL(request.url).searchParams.get("stallId"),
  });
  return parsed.success
    ? { success: true as const, stallId: parsed.data.stallId }
    : {
        success: false as const,
        response: NextResponse.json({ error: "攤位參數格式不正確。" }, { status: 400 }),
      };
}
