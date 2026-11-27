import "server-only";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import type { MiniAppBinding } from "./configuration";
import { readMiniAppBinding } from "./runtime";

export const miniAppResponseHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function guardMiniAppRequest(request: Request): Promise<
  { binding: MiniAppBinding; ipHash: string; response?: never } | { response: NextResponse; binding?: never; ipHash?: never }
> {
  const binding = readMiniAppBinding();
  const origin = new URL(binding.endpointUrl).origin;
  if (new URL(request.url).origin !== origin || request.headers.get("origin") !== origin
    || request.headers.get("sec-fetch-site") === "cross-site") {
    return { response: NextResponse.json({ error: "無法驗證 LINE 登入來源。" }, { status: 403, headers: miniAppResponseHeaders }) };
  }
  const ipHash = hashClientIp(request);
  const rate = await checkRateLimit({ scope: "mini-app-login", identifier: ipHash, limit: 30, windowMs: 15 * 60_000 });
  if (!rate.allowed) return { response: NextResponse.json({ error: "登入次數過多，請稍後再試。" }, {
    status: 429, headers: { ...miniAppResponseHeaders, "Retry-After": String(rate.retryAfterSeconds) },
  }) };
  return { binding, ipHash };
}

export function miniAppErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const unavailable = code === "LINE_MINIAPP_DISABLED" || code === "LINE_MINIAPP_VERIFY_UNAVAILABLE";
  return NextResponse.json({ error: unavailable ? "LINE 登入暫時無法使用，請稍後重試。" : "LINE 登入未完成，請重新登入。" }, {
    status: unavailable ? 503 : 400, headers: miniAppResponseHeaders,
  });
}
