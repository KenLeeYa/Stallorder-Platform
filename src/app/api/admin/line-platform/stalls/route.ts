import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createRequestId } from "@/lib/security";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { requirePlatformRequest, platformErrorResponse, platformPrivateHeaders } from "@/server/line-platform/http";

export async function GET(request: Request) {
  try {
    const { principal,runtime } = await requirePlatformRequest(request);
    if (principal.user.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "僅限平台管理者。" }, { status: 403, headers: platformPrivateHeaders });
    const stalls = await prisma.$queryRaw<Array<{ id: string; name: string; enabled: boolean; cutover_at: Date | null }>>`
      select s.id,s.name,coalesce(p.enabled,false) as enabled,p.cutover_at from public.stalls s
        left join public.line_platform_stalls p on p.stall_id=s.id and p.environment=${runtime.environment}
        where s.is_active order by s.name,s.id limit 200`;
    return NextResponse.json({ environment: runtime.environment, stalls }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { principal,runtime } = await requirePlatformRequest(request,true);
    if (principal.user.platformRole !== "PLATFORM_ADMIN") return NextResponse.json({ error: "僅限平台管理者。" }, { status: 403, headers: platformPrivateHeaders });
    const input = z.object({ stallId: z.string().uuid(), enabled: z.boolean() }).strict().parse(JSON.parse(await readBoundedText(request,1024)));
    await prisma.$transaction(async db => {
      const changed = await db.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,configured_by)
        select id,${runtime.environment},${input.enabled},${principal.user.id}::uuid from public.stalls where id=${input.stallId}::uuid and is_active
        on conflict(stall_id) do update set enabled=excluded.enabled,configured_by=excluded.configured_by,updated_at=now()
          where line_platform_stalls.environment=excluded.environment`;
      if (changed !== 1) throw new Error("LINE_PLATFORM_STALL_UNAVAILABLE");
      await db.auditLog.create({ data: { actorProfileId: principal.user.id, action: input.enabled ? "LINE_PLATFORM_STALL_ENABLED" : "LINE_PLATFORM_STALL_DISABLED",
        entityType: "STALL",entityId: input.stallId,outcome: "SUCCESS",requestId:createRequestId(),metadata: JSON.stringify({ environment: runtime.environment }) } });
    });
    return NextResponse.json({ ok: true }, { headers: platformPrivateHeaders });
  } catch (error) { return platformErrorResponse(error); }
}
