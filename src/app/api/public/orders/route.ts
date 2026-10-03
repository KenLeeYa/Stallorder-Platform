import { createRequestId } from "@/lib/security";
import { getRequestPrincipal } from "@/lib/auth";
import { getPlatformMember } from "@/server/line-platform/member-service";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
import { resolvePublicPlatformOrderContext } from "@/server/line-platform/public-intake";
import { exchangeGuestClaimProof, guestClaimCookieName } from "@/server/line-platform/guest-claim";
import { getPublicOrderOperationId } from "@/lib/public-order-operation-id";
import { readJson } from "@/lib/http";
import { createPerformanceTiming } from "@/lib/performance-timing";
import {
  assertCircuitBRequest,
  circuitBFailureResponse,
  circuitBResponse,
  finalizeCircuitBResponse,
  requireCircuitBClientIp,
} from "@/server/public-order/circuit-b-http";
import { createOrderThroughCircuitB } from "@/server/public-order/circuit-b-service";
import {
  createPublicOrderSchema,
  createPublicOrderValidationCode,
} from "../../../../../supabase/functions/_shared/schemas";
import {
  errorMessage,
  statusForCode,
} from "../../../../../supabase/functions/_shared/public-order-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public/orders",
    requestId,
    operationId,
  });

  try {
    assertCircuitBRequest(request);
    const clientIp = requireCircuitBClientIp(request);
    const body = await readJson(request, requestId);
    if (body.error) {
      return finalizeCircuitBResponse(body.error, requestId, timing, operationId);
    }
    const parsed = createPublicOrderSchema.safeParse(body.data);
    if (!parsed.success) {
      const code = createPublicOrderValidationCode(parsed.error);
      return circuitBResponse(
        { error: errorMessage(code), code },
        statusForCode(code),
        requestId,
        timing,
        operationId,
      );
    }

    const miniApp = new URL(request.url).pathname === "/api/mini/orders";
    let platform: ReturnType<typeof getLinePlatformRuntime> = null;
    try { platform = getLinePlatformRuntime(); } catch (error) { if (miniApp) throw error; }
    const principal = platform ? await getRequestPrincipal(request) : null;
    const member = platform ? await getPlatformMember(principal) : null;
    if (miniApp && (!platform || !member || member.terms_version !== platform.termsVersion)) {
      return circuitBResponse({ error: "請先登入攤點通並同意會員條款。", code: "LINE_PLATFORM_MEMBERSHIP_REQUIRED" }, 403, requestId, timing, operationId);
    }
    const platformContext = platform && member && miniApp ? { profileId: member.profile_id, runtime: platform }
      : platform ? await resolvePublicPlatformOrderContext(parsed.data, member, platform) : null;
    const result = await createOrderThroughCircuitB(parsed.data, {
      clientIp,
      requestId,
      timing,
      ...(platformContext ? { platformContext } : {}),
    });
    const response=circuitBResponse(result.body, result.status, requestId, timing, operationId);
    if (!platformContext && result.status<300 && process.env.LINE_PLATFORM_ENABLED==="true"
      && "trackingToken" in result.body && typeof result.body.trackingToken==="string") {
      try {
        const proof=await exchangeGuestClaimProof(parsed.data.orderSessionToken,result.body.trackingToken,parsed.data.deviceId);
        if (proof) response.cookies.set(guestClaimCookieName(result.body.trackingToken),proof,{httpOnly:true,secure:new URL(request.url).protocol==="https:",sameSite:"strict",path:"/",maxAge:24*60*60});
      } catch {
        // Order is already committed. Missing optional claim configuration cannot undo it.
      }
    }
    return response;
  } catch (error) {
    return circuitBFailureResponse(
      error,
      requestId,
      timing,
      "PUBLIC_ORDER_CIRCUIT_B_FAILED",
      operationId,
    );
  }
}
