import { safeEqual } from "@/lib/security";
import { processStorageReplicationJobs } from "@/server/resilience/storage-replication-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret) {
    return Response.json(
      { error: "CRON_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const result = await processStorageReplicationJobs(10);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
