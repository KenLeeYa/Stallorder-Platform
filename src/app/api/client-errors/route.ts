import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";

const clientErrorSchema = z.object({
  clientEventId: z.string().uuid(),
  type: z.enum(["REACT_BOUNDARY", "WINDOW_ERROR", "UNHANDLED_REJECTION"]),
  errorName: z.enum(["Error", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "NonErrorThrown"]),
  digest: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  surface: z.string().regex(/^[a-z0-9-]{1,40}$/),
}).strict();

export async function POST(request: Request) {
  const requestId = createRequestId();
  if (!isTrustedOrigin(request)) {
    return Response.json({ error: "Forbidden", requestId }, { status: 403 });
  }
  let ipHash: string;
  try {
    ipHash = hashClientIp(request);
  } catch {
    return Response.json(
      { error: "Telemetry unavailable", requestId },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const limit = await checkRateLimit({
    scope: "client-exception-report",
    identifier: ipHash,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many reports", requestId },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(limit.retryAfterSeconds),
        },
      },
    );
  }
  const body = await readJson(request, requestId, { maxBytes: 4_096 });
  if (body.error) return body.error;
  const parsed = clientErrorSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json({ error: "Invalid report", requestId }, { status: 400 });
  }
  logEvent("error", "CLIENT_UNEXPECTED_ERROR", {
    requestId,
    clientEventId: parsed.data.clientEventId,
    errorType: parsed.data.type,
    errorName: parsed.data.errorName,
    digest: parsed.data.digest,
    surface: parsed.data.surface,
  });
  return Response.json({ accepted: true, requestId }, { status: 202 });
}
