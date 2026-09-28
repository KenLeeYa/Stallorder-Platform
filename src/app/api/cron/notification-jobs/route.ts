import { safeEqual } from "@/lib/security";
import { processDueNotificationJobs } from "@/server/notifications/notification-job-processor";
import { processPlatformNotifications } from "@/server/line-platform/notification-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret) return json({ error: "CRON_NOT_CONFIGURED" }, 503);
  if (!safeEqual(authorization, `Bearer ${secret}`)) return json({ error: "UNAUTHORIZED" }, 401);
  const results = await processDueNotificationJobs(new Date(), 20);
  const platformResults = await processPlatformNotifications();
  return json({ processed: results.length + platformResults.length, results: [...results, ...platformResults] }, 200);
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
