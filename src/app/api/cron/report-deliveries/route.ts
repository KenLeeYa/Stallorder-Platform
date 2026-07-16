import { safeEqual } from "@/lib/security";
import { processDueReportSchedules } from "@/lib/report-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503, headers: { "cache-control": "no-store" } });
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const results = await processDueReportSchedules(new Date(), 20);
  return Response.json({ processed: results.length, results }, { headers: { "cache-control": "no-store" } });
}
