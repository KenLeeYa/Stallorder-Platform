import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { kitchenBoardQuerySchema } from "@/lib/kitchen-contract";
import { getKitchenBoardData } from "@/lib/kitchen";

type RouteContext = { params: Promise<{ stallSlug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "VIEW_KDS");
  if (!authorization.ok) return authorization.response;
  const stationId = new URL(request.url).searchParams.get("stationId") ?? undefined;
  const query = kitchenBoardQuerySchema.safeParse({ stationId });
  if (!query.success) {
    return NextResponse.json(
      { error: "工作站篩選條件不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const data = await getKitchenBoardData(
    authorization.stall.organizationId,
    authorization.stall.id,
    query.data.stationId,
  );
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store", "x-request-id": authorization.requestId },
  });
}
