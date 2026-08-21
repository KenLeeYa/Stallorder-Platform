import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";
import { digitalWaitlistSeatingExchangeSchema } from "@/server/waitlist/digital-waitlist-contract";
import {
  digitalWaitlistErrorResponse,
  digitalWaitlistHeaders,
} from "@/server/waitlist/digital-waitlist-http";
import { exchangeDigitalWaitlistSeating } from "@/server/waitlist/digital-waitlist-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const headers = digitalWaitlistHeaders(requestId);
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "入座請求來源無效。", code: "INVALID_ORIGIN" },
      { status: 403, headers },
    );
  }

  const ipHash = hashClientIp(request);
  const limit = await checkRateLimit({
    scope: "digital-waitlist-seating-exchange",
    identifier: ipHash,
    limit: 20,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "入座操作過於頻繁，請稍後再試。", code: "WAITLIST_RATE_LIMITED" },
      {
        status: 429,
        headers: { ...headers, "retry-after": String(limit.retryAfterSeconds) },
      },
    );
  }

  const body = await readJson(request, requestId, { maxBytes: 2_000 });
  if (body.error) return body.error;
  const parsed = digitalWaitlistSeatingExchangeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入座憑證格式不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  try {
    const result = await exchangeDigitalWaitlistSeating({
      ...parsed.data,
      ipHash,
      requestId,
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return digitalWaitlistErrorResponse(error, requestId);
  }
}
