import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { createSyntheticMockConnection } from "@/server/delivery-platforms/connection-service";
import { deliveryPlatformRepository } from "@/server/delivery-platforms/delivery-platform-repository";
import {
  authorizePlatformDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
} from "@/server/delivery-platforms/delivery-http";

const createMockSchema = z.object({
  action: z.literal("CREATE_MOCK"),
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
}).strict();

export async function GET(request: Request) {
  const authorization = await authorizePlatformDeliveryApi(request);
  if (!authorization.ok) return authorization.response;
  const data = await deliveryPlatformRepository.listPlatformAdminData();
  return NextResponse.json(data, {
    headers: deliveryNoStoreHeaders(authorization.requestId),
  });
}

export async function POST(request: Request) {
  const authorization = await authorizePlatformDeliveryApi(request, true);
  if (!authorization.ok) return authorization.response;
  const body = await readJson(request, authorization.requestId, { maxBytes: 4_000 });
  if (body.error) return body.error;
  const parsed = createMockSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Mock 連線資料格式不正確。" },
      { status: 400, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  try {
    const connection = await createSyntheticMockConnection({
      organizationId: parsed.data.organizationId,
      stallId: parsed.data.stallId,
      audit: {
        actorProfileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(
      { connection },
      { status: 201, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const response = deliveryApiErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
