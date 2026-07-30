import { NextResponse } from "next/server";
import { deliveryAdminConnectionCommandSchema } from "@/lib/delivery-platform-contract";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import { setDeliveryConnectionStatus } from "@/server/delivery-platforms/connection-service";
import {
  authorizePlatformDeliveryApi,
  deliveryApiErrorResponse,
  deliveryNoStoreHeaders,
} from "@/server/delivery-platforms/delivery-http";
import { verifyExternalStoreMapping } from "@/server/delivery-platforms/store-mapping-service";
import { retryDeliverySyncJob } from "@/server/delivery-platforms/sync-job-service";
import { DeliveryPlatformError } from "@/server/delivery-platforms/delivery-platform-errors";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { connectionId } = await context.params;
  const authorization = await authorizePlatformDeliveryApi(request, true);
  if (!authorization.ok) return authorization.response;
  const body = await readJson(request, authorization.requestId, { maxBytes: 4_000 });
  if (body.error) return body.error;
  const parsed = deliveryAdminConnectionCommandSchema.safeParse(body.data);
  if (!parsed.success || parsed.data.action === "CREATE_MOCK") {
    return NextResponse.json(
      { error: "連線管理操作格式不正確。" },
      { status: 400, headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  }
  const audit = {
    actorProfileId: authorization.principal.user.id,
    requestId: authorization.requestId,
    ipHash: hashClientIp(request),
  };
  try {
    if (parsed.data.action === "SET_STATUS") {
      const connection = await setDeliveryConnectionStatus({
        connectionId,
        nextStatus: parsed.data.status,
        audit,
      });
      return NextResponse.json(
        { connection },
        { headers: deliveryNoStoreHeaders(authorization.requestId) },
      );
    }
    if (parsed.data.action === "VERIFY_STORE") {
      const mapping = await prisma.externalStoreMapping.findFirst({
        where: { id: parsed.data.mappingId, connectionId },
        select: { id: true },
      });
      if (!mapping) {
        throw new DeliveryPlatformError("STORE_NOT_FOUND", { retryable: false });
      }
      const verified = await verifyExternalStoreMapping({
        mappingId: mapping.id,
        audit: { ...audit, circuit: "PLATFORM_ADMIN" },
      });
      return NextResponse.json(
        { mapping: verified },
        { headers: deliveryNoStoreHeaders(authorization.requestId) },
      );
    }
    const job = await prisma.deliverySyncJob.findFirst({
      where: { id: parsed.data.jobId, connectionId },
      select: { id: true },
    });
    if (!job) {
      throw new DeliveryPlatformError("CONNECTION_NOT_FOUND", { retryable: false });
    }
    const retried = await retryDeliverySyncJob({ jobId: job.id, ...audit });
    return NextResponse.json(
      { job: retried },
      { headers: deliveryNoStoreHeaders(authorization.requestId) },
    );
  } catch (error) {
    const response = deliveryApiErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
