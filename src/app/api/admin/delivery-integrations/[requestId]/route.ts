import { NextResponse } from "next/server";
import { deliveryAdminReviewSchema } from "@/lib/delivery-platform-contract";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { reviewDeliveryConnectionRequest } from "@/server/delivery-platforms/connection-service";
import {
  authorizePlatformDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
} from "@/server/delivery-platforms/delivery-http";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { requestId } = await context.params;
  const authorization = await authorizePlatformDeliveryApi(request, true);
  if (!authorization.ok) return authorization.response;
  const body = await readJson(request, authorization.requestId, { maxBytes: 8_000 });
  if (body.error) return body.error;
  const parsed = deliveryAdminReviewSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "審核資料格式不正確。" },
      { status: 400, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const result = await reviewDeliveryConnectionRequest({
      requestId,
      ...parsed.data,
      audit: {
        actorProfileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(
      result,
      { headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const response = deliveryApiErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
