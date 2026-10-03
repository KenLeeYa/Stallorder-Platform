import { safeEqual } from "@/lib/security";
import { processOutboxDispatchCycle } from "@/server/outbox/outbox-dispatcher";
import { cleanupExpiredFeedback } from "@/server/feedback/feedback-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret) return json({ error: "CRON_NOT_CONFIGURED" }, 503);
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const result = await processOutboxDispatchCycle(`vercel:${crypto.randomUUID()}`, new Date(), 20);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(cleanupExpiredFeedback), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]);
  } catch { /* Feedback maintenance cannot change an already completed dispatch. */ }
  finally { if (timer) clearTimeout(timer); }
  return json({
    processed: result.outcomes.length,
    outcomes: result.outcomes.map((outcome) => ({
      outboxId: outcome.outboxId,
      status: outcome.status,
    })),
    domainQuarantined: result.domainQuarantined,
    health: result.health,
    alerts: result.alerts,
  }, 200);
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
