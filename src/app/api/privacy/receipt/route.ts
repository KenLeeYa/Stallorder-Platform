import { z } from "zod";
import { createRequestId, isTrustedOrigin, hashClientIp } from "@/lib/security";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { ComplianceError, requireCompliance } from "@/server/compliance/access";
import { getPrivacyReceipt } from "@/server/compliance/privacy-service";
import { complianceFailure, complianceJson } from "@/server/compliance/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    if (!isTrustedOrigin(request)) throw new ComplianceError("ORIGIN_DENIED", 403);
    const limit = await checkRateLimit({ scope: "privacy-receipt", identifier: hashClientIp(request), limit: 60, windowMs: 300000 });
    if (!limit.allowed) throw new ComplianceError("RATE_LIMITED", 429);
    const body = await readJson(request, requestId, { maxBytes: 1000 });
    if (body.error) return body.error;
    const value = z.object({ receipt: z.string().length(43), organizationId: z.uuid() }).strict().safeParse(body.data);
    if (!value.success) throw new ComplianceError("INVALID_REQUEST", 400);
    return complianceJson(await getPrivacyReceipt(value.data.receipt, value.data.organizationId, requestId));
  } catch (error) { return complianceFailure(error, requestId); }
}
