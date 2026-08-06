import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashToken, isTrustedOrigin } from "@/lib/security";
import {
  errorMessage,
  statusForCode,
} from "../../../../../../../supabase/functions/_shared/public-order-errors";
import { getPublicOrderSchema } from "../../../../../../../supabase/functions/_shared/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fulfillmentTimeResponseSchema = z.object({
  deviceId: z.string().uuid(),
  version: z.number().int().min(1).max(10_000),
  response: z.enum(["ACCEPT", "DECLINE"]),
}).strict();

type FulfillmentTimeResponseResult = {
  ok: boolean;
  code?: string;
  state?: "CONFIRMED" | "DECLINED";
  version?: number;
  committedFulfillmentAt?: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackingToken: string }> },
) {
  const requestId = createRequestId();
  const headers = { "cache-control": "no-store", "x-request-id": requestId };
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "不允許從此來源確認時間。", code: "INVALID_ORIGIN" },
      { status: 403, headers },
    );
  }

  const body = await readJson(request, requestId, { maxBytes: 2_000 });
  if (body.error) return body.error;
  const parsedBody = fulfillmentTimeResponseSchema.safeParse(body.data);
  const { trackingToken } = await params;
  const parsedIdentity = getPublicOrderSchema.safeParse({
    trackingToken,
    deviceId: parsedBody.success ? parsedBody.data.deviceId : undefined,
  });
  if (!parsedBody.success || !parsedIdentity.success) {
    return NextResponse.json(
      { error: errorMessage("INVALID_REQUEST"), code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  const abuseSecret = process.env.ABUSE_HASH_SECRET?.trim();
  if (!abuseSecret) {
    return NextResponse.json(
      {
        error: errorMessage("FULFILLMENT_TIME_SERVICE_UNAVAILABLE"),
        code: "FULFILLMENT_TIME_SERVICE_UNAVAILABLE",
      },
      { status: 503, headers },
    );
  }

  const trackingTokenHash = hashToken(parsedIdentity.data.trackingToken);
  const deviceHash = createHmac("sha256", abuseSecret)
    .update(`device:${parsedIdentity.data.deviceId}`)
    .digest("hex");

  try {
    const limit = await checkRateLimit({
      scope: "public-fulfillment-time-response",
      identifier: `${trackingTokenHash}:${deviceHash}`,
      limit: 12,
      windowMs: 15 * 60_000,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: errorMessage("RATE_LIMITED"), code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { ...headers, "retry-after": String(limit.retryAfterSeconds) },
        },
      );
    }

    const rows = await prisma.$queryRaw<Array<{ result: FulfillmentTimeResponseResult | null }>>(
      Prisma.sql`
        select public.respond_to_fulfillment_time(
          ${trackingTokenHash}::text,
          ${deviceHash}::text,
          ${parsedBody.data.version}::integer,
          ${parsedBody.data.response}::text
        ) as result
      `,
    );
    const result = rows[0]?.result;
    if (!result?.ok) {
      const code = result?.code ?? "FULFILLMENT_TIME_SERVICE_UNAVAILABLE";
      return NextResponse.json(
        { error: errorMessage(code), code },
        { status: statusForCode(code), headers },
      );
    }

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    const detail = error instanceof Error
      ? error.message.replace(/[\r\n]/g, " ").slice(0, 300)
      : "unknown";
    console.error(JSON.stringify({
      level: "error",
      event: "PUBLIC_FULFILLMENT_TIME_RESPONSE_FAILED",
      requestId,
      detail,
    }));
    return NextResponse.json(
      {
        error: errorMessage("FULFILLMENT_TIME_SERVICE_UNAVAILABLE"),
        code: "FULFILLMENT_TIME_SERVICE_UNAVAILABLE",
      },
      { status: 503, headers },
    );
  }
}
