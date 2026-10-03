import "server-only";
import { NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLinePlatformRuntime } from "./runtime";

export const platformPrivateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
export async function requirePlatformRequest(request: Request, mutation = false) {
  const runtime = getLinePlatformRuntime();
  if (!runtime) throw new Error("LINE_PLATFORM_DISABLED");
  const principal = await getRequestPrincipal(request);
  if (!principal) throw new Error("LINE_PLATFORM_LOGIN_REQUIRED");
  if (mutation && !validateCsrf(request, principal)) throw new Error("LINE_PLATFORM_CSRF_INVALID");
  const rate = await checkRateLimit({ scope: "line-platform-member", identifier: principal.user.id, limit: 120, windowMs: 60_000 });
  if (!rate.allowed) throw new Error("LINE_PLATFORM_RATE_LIMITED");
  return { runtime, principal };
}
export function platformErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "LINE_PLATFORM_DISABLED" ? 503 : code === "LINE_PLATFORM_LOGIN_REQUIRED" ? 401
    : code === "LINE_PLATFORM_CSRF_INVALID" ? 403 : code === "LINE_PLATFORM_RATE_LIMITED" ? 429
      : code === "LINE_PLATFORM_ORDER_NOT_FOUND" ? 404 : 400;
  return NextResponse.json({ error: status === 401 ? "請先以 LINE 登入攤點通。" : status === 404 ? "找不到可查看的訂單。"
    : status === 503 ? "平台 LINE 功能尚未啟用。" : "操作未完成，請重新整理後再試。" }, { status, headers: platformPrivateHeaders });
}
