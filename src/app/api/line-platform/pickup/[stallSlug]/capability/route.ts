import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { pickupPrivateHeaders } from "@/server/line-platform/pickup-http";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { prisma } from "@/lib/prisma";
export async function GET(request: Request, context: { params: Promise<{ stallSlug: string }> }) {
  const authorization = await authorizeApiRequest(request, (await context.params).stallSlug, "CHECKOUT_ORDERS");
  if (!authorization.ok) return authorization.response;
  try {
    const runtime = getLinePlatformRuntime();
    if (!runtime) return NextResponse.json({ enabled: false }, { headers: pickupPrivateHeaders });
    const [scope] = await prisma.$queryRaw<Array<{ enabled: boolean }>>`
      select (${runtime.pickupEnabled} and exists (select 1 from public.line_platform_stalls
        where stall_id = ${authorization.stall.id}::uuid and environment = ${runtime.environment} and enabled))
        or exists (select 1 from public.orders o join public.line_platform_order_owners owner on owner.order_id=o.id
          where o.stall_id = ${authorization.stall.id}::uuid and owner.environment = ${runtime.environment}
            and o.status not in ('COMPLETED','CANCELLED','EXPIRED')
            and (owner.pickup_required or exists (select 1 from public.line_platform_pickup_credentials c
              where c.order_id=o.id and c.environment=${runtime.environment} and c.consumed_at is null))) as enabled
    `;
    return NextResponse.json({ enabled: scope.enabled }, { headers: pickupPrivateHeaders });
  } catch { return NextResponse.json({ enabled: false }, { headers: pickupPrivateHeaders }); }
}
