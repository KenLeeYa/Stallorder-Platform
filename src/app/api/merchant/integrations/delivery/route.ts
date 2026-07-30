import { NextResponse } from "next/server";
import {
  deliveryConnectionRequestSchema,
  deliveryStallQuerySchema,
} from "@/lib/delivery-platform-contract";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import {
  getMerchantDeliveryIntegrationData,
  submitDeliveryConnectionRequest,
} from "@/server/delivery-platforms/connection-service";
import {
  authorizeMerchantDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
  validateDeliveryCsrf,
} from "@/server/delivery-platforms/delivery-http";

export async function GET(request: Request) {
  const query = deliveryStallQuerySchema.safeParse({
    stallId: new URL(request.url).searchParams.get("stallId"),
  });
  if (!query.success) {
    return NextResponse.json({ error: "攤位參數格式不正確。" }, { status: 400 });
  }
  const authorization = await authorizeMerchantDeliveryApi(request, query.data.stallId);
  if (!authorization.ok) return authorization.response;
  const data = await getMerchantDeliveryIntegrationData(
    authorization.workspace.id,
    [query.data.stallId],
  );
  return NextResponse.json(data, {
    headers: deliveryNoStoreHeaders(authorization.requestId),
  });
}

export async function POST(request: Request) {
  const body = await readJson(request, undefined, { maxBytes: 16_000 });
  if (body.error) return body.error;
  const parsed = deliveryConnectionRequestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "申請資料格式不正確。" },
      { status: 400 },
    );
  }
  const authorization = await authorizeMerchantDeliveryApi(
    request,
    parsed.data.stallId,
    parsed.data.provider,
  );
  if (!authorization.ok) return authorization.response;
  const csrfError = validateDeliveryCsrf(request, authorization);
  if (csrfError) return csrfError;
  try {
    const created = await submitDeliveryConnectionRequest({
      organizationId: authorization.workspace.id,
      ...parsed.data,
      audit: {
        actorProfileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(
      { request: created },
      { status: 201, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const response = deliveryApiErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
