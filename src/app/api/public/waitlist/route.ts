import { NextResponse } from "next/server";
import { readJson } from "@/lib/http";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";
import { digitalWaitlistJoinSchema } from "@/server/waitlist/digital-waitlist-contract";
import {
  digitalWaitlistErrorResponse,
  digitalWaitlistHeaders,
} from "@/server/waitlist/digital-waitlist-http";
import { joinDigitalWaitlist } from "@/server/waitlist/digital-waitlist-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const headers = digitalWaitlistHeaders(requestId);
  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "候位請求來源無效。", code: "INVALID_ORIGIN" },
      { status: 403, headers },
    );
  }

  const body = await readJson(request, requestId, { maxBytes: 4_000 });
  if (body.error) return body.error;
  const parsed = digitalWaitlistJoinSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "候位資料格式不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  try {
    const result = await joinDigitalWaitlist({
      ...parsed.data,
      ipHash: hashClientIp(request),
      requestId,
    });
    return NextResponse.json(result, { status: 201, headers });
  } catch (error) {
    return digitalWaitlistErrorResponse(error, requestId);
  }
}
