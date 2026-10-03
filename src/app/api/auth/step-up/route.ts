import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId } from "@/lib/security";
import { ComplianceError, requireCompliance } from "@/server/compliance/access";
import { issueStepUp } from "@/server/compliance/step-up";
import { complianceFailure, complianceJson } from "@/server/compliance/http";
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    const principal = await getRequestPrincipal(request);
    if (!principal) throw new ComplianceError("LOGIN_REQUIRED", 401);
    if (!validateCsrf(request, principal)) throw new ComplianceError("CSRF_DENIED", 403);
    const limit = await checkRateLimit({ scope: "step-up", identifier: principal.sessionId, limit: 10, windowMs: 300000 });
    if (!limit.allowed) throw new ComplianceError("RATE_LIMITED", 429);
    const body = await readJson(request, requestId, { maxBytes: 20000 });
    if (body.error) return body.error;
    const parsed = z.object({ token: z.string().min(32).max(16000), action: z.string().max(80), contentDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(body.data);
    if (!parsed.success) throw new ComplianceError("INVALID_REQUEST", 400);
    return complianceJson(await issueStepUp(principal, parsed.data));
  } catch (error) { return complianceFailure(error, requestId); }
}
