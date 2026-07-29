import { safeEqual } from "@/lib/security";
import { captureReplicationHealthSnapshot } from "@/server/resilience/replication-monitor";

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
  const snapshot = await captureReplicationHealthSnapshot();
  return Response.json(
    {
      status: snapshot.status,
      observedAt: snapshot.observedAt,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
