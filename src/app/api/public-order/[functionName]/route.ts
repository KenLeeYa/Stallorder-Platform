import { NextRequest, NextResponse } from "next/server";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import {
  publicOrderUpstreamIpHeaders,
  trustedPublicOrderClientIp,
} from "@/lib/public-order-proxy-headers";
import { createRequestId } from "@/lib/security";
import {
  BoundedTextReadError,
  readBoundedText,
} from "@/server/delivery-platforms/bounded-text-reader";
import {
  getPublicOrderOperationId,
  PUBLIC_ORDER_OPERATION_ID_HEADER,
} from "@/lib/public-order-operation-id";

const ALLOWED_FUNCTIONS = new Set([
  "create-order-session",
  "create-public-order",
  "get-public-order",
  "manage-line-link",
  "prepare-reorder",
]);
const MAX_PUBLIC_ORDER_BODY_BYTES = 256 * 1024;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicFunctionsBaseUrl() {
  return (
    process.env.SUPABASE_FUNCTIONS_URL
    || process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
    || "http://127.0.0.1:54321/functions/v1"
  ).replace(/\/$/, "");
}

function publicFunctionOrigin() {
  const configured = process.env.PUBLIC_ORDER_FUNCTION_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return "https://app.qidaigo.com";
  try {
    return new URL(configured).origin;
  } catch {
    throw new Error("PUBLIC_ORDER_FUNCTION_ORIGIN or NEXT_PUBLIC_APP_URL must be a valid URL.");
  }
}

function publicFunctionGatewayHeaders() {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required for public order functions.");
  }
  return {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ functionName: string }> },
) {
  const requestId = createRequestId();
  const operationId = getPublicOrderOperationId(request);
  const timing = createPerformanceTiming({
    route: "/api/public-order/:functionName",
    requestId,
    operationId,
  });
  const { functionName } = await params;
  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    return finalizePerformanceResponse(
      NextResponse.json(
        { error: "找不到此公開點餐服務。", code: "FUNCTION_NOT_FOUND" },
        { status: 404, headers: { [PUBLIC_ORDER_OPERATION_ID_HEADER]: operationId } },
      ),
      timing,
    );
  }

  const clientIp = trustedPublicOrderClientIp(request);
  let requestBody: string;
  try {
    requestBody = await readBoundedText(request, MAX_PUBLIC_ORDER_BODY_BYTES);
  } catch (error) {
    const status = error instanceof BoundedTextReadError
      && (error.reason === "BODY_TOO_LARGE" || error.reason === "INVALID_CONTENT_LENGTH")
      ? 413
      : 408;
    return finalizePerformanceResponse(
      NextResponse.json(
        { error: status === 413 ? "點餐資料超過允許大小。" : "點餐資料讀取逾時，請重試。", code: status === 413 ? "REQUEST_TOO_LARGE" : "REQUEST_TIMEOUT" },
        { status, headers: { [PUBLIC_ORDER_OPERATION_ID_HEADER]: operationId } },
      ),
      timing,
    );
  }

  const upstream = await timing.measure("externalApiMs", () => fetch(`${publicFunctionsBaseUrl()}/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      "x-stallorder-protocol-version":
        request.headers.get("x-stallorder-protocol-version") ?? "1",
      [PUBLIC_ORDER_OPERATION_ID_HEADER]: operationId,
      origin: publicFunctionOrigin(),
      ...publicFunctionGatewayHeaders(),
      ...publicOrderUpstreamIpHeaders(clientIp),
    },
    body: requestBody,
    cache: "no-store",
  }));
  const responseBody = await upstream.text();
  return finalizePerformanceResponse(new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-upstream-request-id": upstream.headers.get("x-request-id") ?? "",
      [PUBLIC_ORDER_OPERATION_ID_HEADER]: operationId,
    },
  }), timing);
}
