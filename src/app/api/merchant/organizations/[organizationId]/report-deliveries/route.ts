import { reportHttp } from "@/server/reports/report-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ organizationId: string; deliveryId?: string }> };
export async function GET(request: Request, context: Context) {
  const { organizationId, deliveryId } = await context.params;
  return reportHttp(request, "list", organizationId, deliveryId);
}
