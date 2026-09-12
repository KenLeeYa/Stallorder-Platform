import { safeEqual } from "@/lib/security";
import { processStaffPushJobs } from "@/server/notifications/staff-push-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", "Bearer " + secret)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return Response.json(await processStaffPushJobs(), { headers: { "cache-control": "no-store" } });
}
