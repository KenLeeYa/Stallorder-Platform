import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createRequestId, hashToken, isTrustedOrigin } from "@/lib/security";
import {
  errorMessage,
  statusForCode,
} from "../../../../../supabase/functions/_shared/public-order-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const drawSchema = z.object({
  orderSessionToken: z.string().min(40).max(200),
  deviceId: z.string().uuid(),
}).strict();

type DrawResult = {
  ok: boolean;
  code?: string;
  drawId?: string;
  productId?: string;
  productName?: string;
  discountWon?: boolean;
  discountLabel?: string | null;
  discountRateBps?: number | null;
  expiresAt?: string;
  idempotentReplay?: boolean;
};

export async function POST(request: Request) {
  const requestId = createRequestId();
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "請從點餐頁使用抽抽樂。", code: "INVALID_ORIGIN" },
      { status: 403, headers },
    );
  }

  const body = await readJson(request, requestId, { maxBytes: 4_000 });
  if (body.error) return body.error;
  const parsed = drawSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "抽抽樂資料不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  const abuseSecret = process.env.ABUSE_HASH_SECRET?.trim();
  if (!abuseSecret) {
    return NextResponse.json(
      { error: "抽抽樂目前無法使用。", code: "LOTTERY_UNAVAILABLE" },
      { status: 503, headers },
    );
  }
  const sessionHash = hashToken(parsed.data.orderSessionToken);
  const deviceHash = createHmac("sha256", abuseSecret)
    .update(`device:${parsed.data.deviceId}`)
    .digest("hex");

  const rows = await prisma.$queryRaw<Array<{ result: DrawResult | null }>>(Prisma.sql`
    select public.draw_public_lottery(
      ${sessionHash}::text,
      ${deviceHash}::text
    ) as result
  `);
  const result = rows[0]?.result;
  if (!result?.ok) {
    const code = result?.code ?? "LOTTERY_UNAVAILABLE";
    return NextResponse.json(
      { error: errorMessage(code), code },
      { status: statusForCode(code), headers },
    );
  }
  return NextResponse.json(result, { status: 200, headers });
}
