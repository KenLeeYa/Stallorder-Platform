import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { persistPlatformWebhook } from "@/server/line-platform/notification-webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return Response.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  try {
    const config = getLinePlatformRuntime();
    if (!config) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    await persistPlatformWebhook(await readBoundedText(request, 64_000), request.headers.get("x-line-signature"), config);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "WEBHOOK_UNAVAILABLE";
    const invalid = ["INVALID_SIGNATURE","DESTINATION_MISMATCH","INVALID_FRIENDSHIP_EVENT"].includes(code);
    return Response.json({ error: invalid ? code : "WEBHOOK_UNAVAILABLE" }, { status: invalid ? 400 : 503, headers: { "cache-control": "no-store" } });
  }
}
