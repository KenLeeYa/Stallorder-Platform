import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeApiRequest } from "@/lib/authorization";
import { handlePickupStaffCommand, pickupPrivateHeaders, pickupErrorResponse } from "@/server/line-platform/pickup-http";
import { getPlatformPickupManagement } from "@/server/line-platform/pickup-service";
export async function POST(request: Request, context: { params: Promise<{ stallSlug: string }> }) {
  return handlePickupStaffCommand(request, (await context.params).stallSlug, "manage");
}
export async function GET(request: Request, context: { params: Promise<{ stallSlug: string }> }) {
  const authorization = await authorizeApiRequest(request, (await context.params).stallSlug, "CHECKOUT_ORDERS");
  if (!authorization.ok) return authorization.response;
  const orderId = z.uuid().safeParse(new URL(request.url).searchParams.get("orderId"));
  if (!orderId.success) return NextResponse.json({ error: "請選擇訂單。" }, { status: 400, headers: pickupPrivateHeaders });
  try {
    return NextResponse.json(await getPlatformPickupManagement(authorization.stall.id, orderId.data), { headers: pickupPrivateHeaders });
  } catch (error) { return pickupErrorResponse(error); }
}
