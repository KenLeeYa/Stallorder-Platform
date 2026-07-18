import { NextRequest, NextResponse } from "next/server";

const ALLOWED_FUNCTIONS = new Set([
  "create-order-session",
  "create-public-order",
  "get-public-order",
]);

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

function trustedClientIp(request: Request) {
  const candidate = (
    request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")
  )?.trim();
  return candidate && !candidate.includes(",") ? candidate : null;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ functionName: string }> },
) {
  const { functionName } = await params;
  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    return NextResponse.json({ error: "找不到此公開點餐服務。", code: "FUNCTION_NOT_FOUND" }, { status: 404 });
  }

  const clientIp = trustedClientIp(request);

  const upstream = await fetch(`${publicFunctionsBaseUrl()}/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      origin: publicFunctionOrigin(),
      ...publicFunctionGatewayHeaders(),
      ...(clientIp ? { "x-real-ip": clientIp, "cf-connecting-ip": clientIp } : {}),
    },
    body: await request.text(),
    cache: "no-store",
  });
  const responseBody = await upstream.text();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
      "x-upstream-request-id": upstream.headers.get("x-request-id") ?? "",
    },
  });
}
