import { z } from "zod";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { createRequestId, isTrustedOrigin, hashClientIp } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";
import { ComplianceError, requireCompliance } from "@/server/compliance/access";
import { receivePrivacyExport } from "@/server/compliance/export-service";
import { complianceFailure, complianceJson } from "@/server/compliance/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    if (!isTrustedOrigin(request)) throw new ComplianceError("ORIGIN_DENIED", 403);
    const limit = await checkRateLimit({ scope: "privacy-export", identifier: hashClientIp(request), limit: 60, windowMs: 300000 });
    if (!limit.allowed) throw new ComplianceError("RATE_LIMITED", 429);
    const principal = await getRequestPrincipal(request);
    if (principal && !validateCsrf(request, principal)) throw new ComplianceError("CSRF_DENIED", 403);
    const body = await readJson(request, requestId, { maxBytes: 1500 }); if (body.error) return body.error;
    const input = z.object({ organizationId: z.uuid(), receipt: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      acknowledgement: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().safeParse(body.data);
    if (!input.success) throw new ComplianceError("INVALID_REQUEST", 400);
    return complianceJson(await receivePrivacyExport(input.data, principal, requestId));
  } catch (error) { return complianceFailure(error, requestId); }
}
