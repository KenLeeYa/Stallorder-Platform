// Use exactly the existing intake, pricing, stock, capacity and abuse gates.
export { POST } from "@/app/api/public/orders/route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { listPlatformOrders } from "@/server/line-platform/member-service";
import { requirePlatformRequest, platformErrorResponse, platformPrivateHeaders } from "@/server/line-platform/http";
export async function GET(request: Request) {
  try {
    const { principal } = await requirePlatformRequest(request);
    const params = new URL(request.url).searchParams;
    const page = z.coerce.number().int().min(1).max(1000).parse(params.get("page") ?? 1);
    const stallId = params.get("stall") ? z.string().uuid().parse(params.get("stall")) : null;
    const rows = await listPlatformOrders(principal, { page, stallId, history: params.get("view") === "history" });
    return NextResponse.json({ orders: rows.slice(0,20), hasMore: rows.length>20 }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
