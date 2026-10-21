import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePlatformOrderOwner } from "@/server/line-platform/member-service";
import { ensurePickupMediaForOrder, requirePickupRuntime } from "@/server/line-platform/pickup-service";
import { pickupPrivateHeaders, pickupErrorResponse } from "@/server/line-platform/pickup-http";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const principal = await getRequestPrincipal(request);
  if (!principal) return NextResponse.json({ error: "請先登入。" }, { status: 401, headers: pickupPrivateHeaders });
  if (!validateCsrf(request, principal)) return NextResponse.json({ error: "安全驗證已失效。" }, { status: 403, headers: pickupPrivateHeaders });
  const parsed = z.uuid().safeParse((await context.params).orderId);
  if (!parsed.success) return NextResponse.json({ error: "找不到訂單。" }, { status: 404, headers: pickupPrivateHeaders });
  try {
    const runtime = requirePickupRuntime();
    await requirePlatformOrderOwner(principal, parsed.data);
    const rate = await checkRateLimit({ scope: "line-platform-pickup-customer", identifier: principal.user.id, limit: 30, windowMs: 60_000 });
    if (!rate.allowed) return NextResponse.json({ error: "請稍後再試。" }, { status: 429, headers: pickupPrivateHeaders });
    const media = await ensurePickupMediaForOrder(parsed.data, runtime.environment);
    return NextResponse.json({ media }, { headers: pickupPrivateHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "LINE_PLATFORM_ORDER_NOT_FOUND") {
      return NextResponse.json({ error: "找不到訂單。" }, { status: 404, headers: pickupPrivateHeaders });
    }
    return pickupErrorResponse(error);
  }
}
