import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/security";
import { processAutomaticPaygClose } from "@/server/billing/payg-automatic-close-service";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const result = await processAutomaticPaygClose();
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
