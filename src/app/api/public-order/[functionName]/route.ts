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

  const upstream = await fetch(`${publicFunctionsBaseUrl()}/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      origin: process.env.PUBLIC_ORDER_FUNCTION_ORIGIN || "https://app.qidaigo.com",
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
