import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, isTrustedOrigin, hashClientIp } from "@/lib/security";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { prisma } from "@/lib/prisma";
import { assertCircuitBRequest, requireCircuitBClientIp } from "@/server/public-order/circuit-b-http";
import { getOrderThroughCircuitB, PublicOrderCircuitError } from "@/server/public-order/circuit-b-service";
import { getPublicOrderSchema } from "../../../../../supabase/functions/_shared/schemas";
import { ComplianceError, requireCompliance, withActor } from "@/server/compliance/access";
import { requestCommand } from "@/server/compliance/contracts";
import { createPrivacyRequest } from "@/server/compliance/privacy-service";
import { digest } from "@/server/compliance/crypto";
import { complianceJson, complianceFailure } from "@/server/compliance/http";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("subject", [
  z.object({ subject: z.literal("ACCOUNT"), organizationId: z.uuid(), command: requestCommand }).strict(),
  z.object({ subject: z.literal("ORDER"), trackingToken: z.string().min(24).max(200), command: requestCommand }).strict(),
]);
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    requireCompliance();
    if (!isTrustedOrigin(request)) throw new ComplianceError("ORIGIN_DENIED", 403);
    const limit = await checkRateLimit({ scope: "privacy-request", identifier: hashClientIp(request), limit: 30, windowMs: 3600000 });
    if (!limit.allowed) throw new ComplianceError("RATE_LIMITED", 429);
    const body = await readJson(request, requestId, { maxBytes: 12000 });
    if (body.error) {
      body.error.headers.set("cache-control", "private, no-store");
      body.error.headers.set("cdn-cache-control", "no-store");
      return body.error;
    }
    const parsed = schema.safeParse(body.data);
    if (!parsed.success) throw new ComplianceError("INVALID_REQUEST", 400);
    const input = parsed.data;
    if (input.subject === "ACCOUNT") {
      const principal = await getRequestPrincipal(request);
      if (!principal) throw new ComplianceError("LOGIN_REQUIRED", 401);
      if (!validateCsrf(request, principal)) throw new ComplianceError("CSRF_DENIED", 403);
      return complianceJson(await withActor(principal, input.organizationId, "SUBJECT", (tx) =>
        createPrivacyRequest(tx, { organizationId: input.organizationId, profileId: principal.user.id }, input.command, requestId)), 201);
    }
    assertCircuitBRequest(request);
    const identity = getPublicOrderSchema.safeParse({ trackingToken: input.trackingToken, deviceId: request.headers.get("x-stallorder-device-id") });
    if (!identity.success) throw new ComplianceError("INVALID_REQUEST", 400);
    // Reuse the real order/device/rate gate; token possession alone is insufficient.
    const result = await getOrderThroughCircuitB(identity.data, { clientIp: requireCircuitBClientIp(request), requestId,
      timing: createPerformanceTiming({ route: "/api/privacy/requests", requestId }) });
    if (result.status !== 200) throw new ComplianceError("ORDER_NOT_FOUND", 404);
    return complianceJson(await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { trackingTokenHash: digest(input.trackingToken) }, select: { id: true, organizationId: true, stallId: true } });
      if (!order) throw new ComplianceError("ORDER_NOT_FOUND", 404);
      return createPrivacyRequest(tx, { organizationId: order.organizationId, stallId: order.stallId, orderId: order.id }, input.command, requestId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), 201);
  } catch (error) {
    return complianceFailure(error instanceof PublicOrderCircuitError ? new ComplianceError(error.code, error.status) : error, requestId);
  }
}
