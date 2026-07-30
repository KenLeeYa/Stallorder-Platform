import "server-only";

import { NextResponse } from "next/server";
import { logEvent } from "@/lib/audit";
import {
  createPerformanceTiming,
  finalizePerformanceResponse,
} from "@/lib/performance-timing";
import { trustedPublicOrderClientIp } from "@/lib/public-order-proxy-headers";
import { isTrustedOrigin } from "@/lib/security";
import {
  errorMessage,
  statusForCode,
} from "../../../supabase/functions/_shared/public-order-errors";
import { isSupportedPublicOrderProtocol } from "../../../supabase/functions/_shared/public-order-protocol";
import { PublicOrderCircuitError } from "@/server/public-order/circuit-b-service";

type Timing = ReturnType<typeof createPerformanceTiming>;

export function assertCircuitBRequest(request: Request) {
  if (!isTrustedOrigin(request)) {
    throw new PublicOrderCircuitError("ORIGIN_NOT_ALLOWED", 403);
  }
  if (!isSupportedPublicOrderProtocol(
    request.headers.get("x-stallorder-protocol-version"),
  )) {
    throw new PublicOrderCircuitError("CLIENT_VERSION_UNSUPPORTED", 426);
  }
}

export function requireCircuitBClientIp(request: Request) {
  const clientIp = trustedPublicOrderClientIp(request);
  if (!clientIp) {
    throw new PublicOrderCircuitError("REQUEST_SOURCE_UNAVAILABLE", 503);
  }
  return clientIp;
}

export function circuitBResponse(
  body: unknown,
  status: number,
  requestId: string,
  timing: Timing,
) {
  return finalizeCircuitBResponse(
    NextResponse.json(body, { status }),
    requestId,
    timing,
  );
}

export function finalizeCircuitBResponse<T extends Response>(
  response: T,
  requestId: string,
  timing: Timing,
) {
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-order-circuit", "B");
  response.headers.set("x-request-id", requestId);
  return finalizePerformanceResponse(response, timing);
}

export function circuitBFailureResponse(
  error: unknown,
  requestId: string,
  timing: Timing,
  event: string,
) {
  const code = error instanceof PublicOrderCircuitError
    ? error.code
    : "ORDER_CREATE_ERROR";
  const status = error instanceof PublicOrderCircuitError
    ? error.status
    : statusForCode(code);

  if (!(error instanceof PublicOrderCircuitError)) {
    logEvent("error", event, { requestId, circuit: "B" });
  }

  return circuitBResponse(
    {
      error: errorMessage(code),
      code,
      ...(error instanceof PublicOrderCircuitError
        ? error.responseBody
        : undefined),
    },
    status,
    requestId,
    timing,
  );
}
