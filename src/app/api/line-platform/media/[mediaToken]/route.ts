import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { renderPickupMedia } from "@/server/line-platform/pickup-service";
import { pickupPrivateHeaders } from "@/server/line-platform/pickup-http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ mediaToken: string }> }) {
  const headers = { ...pickupPrivateHeaders, "Content-Type": "image/png", "Content-Disposition": "inline; filename=pickup.png" };
  try {
    const rate = await checkRateLimit({ scope: "line-platform-pickup-media", identifier: hashClientIp(request), limit: 180, windowMs: 60_000 });
    if (!rate.allowed) return new Response(null, { status: 429, headers });
    const png = await renderPickupMedia((await context.params).mediaToken);
    return new Response(new Uint8Array(png), { headers });
  } catch { return new Response(null, { status: 404, headers }); }
}
