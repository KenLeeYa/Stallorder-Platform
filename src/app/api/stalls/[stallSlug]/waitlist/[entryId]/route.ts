import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { digitalWaitlistTransitionSchema } from "@/server/waitlist/digital-waitlist-contract";
import {
  digitalWaitlistErrorResponse,
  digitalWaitlistHeaders,
} from "@/server/waitlist/digital-waitlist-http";
import { transitionDigitalWaitlistEntry } from "@/server/waitlist/digital-waitlist-service";

type RouteContext = {
  params: Promise<{ stallSlug: string; entryId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { stallSlug, entryId } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "OPERATE_CAPACITY");
  if (!authorization.ok) return authorization.response;
  const headers = digitalWaitlistHeaders(authorization.requestId);

  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。", code: "CSRF_INVALID" },
      { status: 403, headers },
    );
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entryId)) {
    return NextResponse.json(
      { error: "候位識別格式不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  const body = await readJson(request, authorization.requestId, { maxBytes: 2_000 });
  if (body.error) return body.error;
  const parsed = digitalWaitlistTransitionSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "候位操作格式不正確。", code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  }

  try {
    const result = await transitionDigitalWaitlistEntry({
      organizationId: authorization.stall.organizationId,
      stallId: authorization.stall.id,
      entryId,
      expectedVersion: parsed.data.expectedVersion,
      operation: parsed.data.operation,
      diningTableId: parsed.data.diningTableId ?? null,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
      requestId: authorization.requestId,
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return digitalWaitlistErrorResponse(error, authorization.requestId);
  }
}
