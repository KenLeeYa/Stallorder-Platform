import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";
import { digitalWaitlistStatusSchema } from "@/server/waitlist/digital-waitlist-contract";
import {
  digitalWaitlistErrorResponse,
  digitalWaitlistHeaders,
} from "@/server/waitlist/digital-waitlist-http";
import { getDigitalWaitlistStatus } from "@/server/waitlist/digital-waitlist-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const headers = digitalWaitlistHeaders(requestId);
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "候位查詢來源無效。", code: "INVALID_ORIGIN" },
      { status: 403, headers },
    );
  }

  const ipHash = hashClientIp(request);
  const limit = await checkRateLimit({
    scope: "digital-waitlist-status",
    identifier: ipHash,
    limit: 120,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "候位查詢過於頻繁，請稍後再試。", code: "WAITLIST_RATE_LIMITED" },
      {
        status: 429,
        headers: { ...headers, "retry-after": String(limit.retryAfterSeconds) },
      },
    );
  }

  const body = await readJson(request, requestId, { maxBytes: 1_000 });
  if (body.error) return body.error;
  const parsed = digitalWaitlistStatusSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "候位憑證格式不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  try {
    return NextResponse.json(
      await getDigitalWaitlistStatus(parsed.data.publicToken),
      { headers },
    );
  } catch (error) {
    return digitalWaitlistErrorResponse(error, requestId);
  }
}
