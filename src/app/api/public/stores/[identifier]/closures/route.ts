import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePublicStorefront } from "@/lib/public-storefront";
import { dateInTimeZone, serializeSpecialClosure } from "@/lib/special-closures";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  try {
    const store = await resolvePublicStorefront((await params).identifier);
    if (!store) return NextResponse.json({ code: "STORE_NOT_FOUND" }, { status: 404, headers });
    const { id, timezone } = store.stall;
    const closures = await prisma.stallSpecialClosure.findMany({
      where: { stallId: id, endsOn: { gte: new Date(dateInTimeZone(new Date(), timezone) + "T00:00:00Z") } },
      orderBy: { startsOn: "asc" },
      select: { id: true, startsOn: true, endsOn: true, opensAt: true, closesAt: true, title: true, message: true },
    });
    return NextResponse.json({ timezone, closures: closures.map(serializeSpecialClosure) }, { headers });
  } catch {
    return NextResponse.json({ code: "STORE_CLOSURES_UNAVAILABLE" }, { status: 503, headers });
  }
}
