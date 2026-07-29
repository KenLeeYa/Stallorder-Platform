import { NextResponse } from "next/server";
import { deliveryStallQuerySchema } from "@/lib/delivery-platform-contract";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import {
  authorizeMerchantDeliveryApi,
  deliveryNoStoreHeaders,
} from "@/server/delivery-platforms/delivery-http";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { connectionId } = await context.params;
  const query = deliveryStallQuerySchema.safeParse({
    stallId: new URL(request.url).searchParams.get("stallId"),
  });
  if (!query.success) {
    return NextResponse.json({ error: "攤位參數格式不正確。" }, { status: 400 });
  }
  const authorization = await authorizeMerchantDeliveryApi(request, query.data.stallId);
  if (!authorization.ok) return authorization.response;
  const connection = await deliveryPlatformRepository.findScopedConnection(
    connectionId,
    authorization.workspace.id,
    query.data.stallId,
  );
  if (!connection) {
    return NextResponse.json(
      { error: "找不到外送平台連線。" },
      { status: 404, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  const orders = await deliveryPlatformRepository.listExternalOrders(
    connection.id,
    authorization.workspace.id,
    query.data.stallId,
  );
  return NextResponse.json(
    { orders },
    { headers: deliveryNoStoreHeaders(authorization.requestId) },
  );
}
