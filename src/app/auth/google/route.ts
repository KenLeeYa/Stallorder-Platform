import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPerformanceTiming, finalizePerformanceResponse } from "@/lib/performance-timing";
import { createRequestId, hashClientIp, sanitizeRedirectPath } from "@/lib/security";
import { createSupabaseAuthClient, isGoogleLoginEnabled } from "@/lib/supabase-auth";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const timing = createPerformanceTiming({ route: "/auth/google", requestId });
  const finalize = <T extends Response>(response: T) => finalizePerformanceResponse(response, timing);
  const requestUrl = new URL(request.url);
  const next = sanitizeRedirectPath(requestUrl.searchParams.get("next"), "/");
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : requestUrl.origin;

  if (!isGoogleLoginEnabled()) {
    return finalize(NextResponse.redirect(`${appOrigin}/login?oauthError=not-configured`));
  }

  const rateLimit = await timing.measureDb(() => checkRateLimit({
    scope: "google-oauth-start",
    identifier: hashClientIp(request),
    limit: 20,
    windowMs: 15 * 60_000,
  }));
  if (!rateLimit.allowed) {
    return finalize(NextResponse.redirect(`${appOrigin}/login?oauthError=rate-limited`));
  }

  try {
    const supabase = await timing.measure("sessionMs", () => createSupabaseAuthClient());
    const redirectTo = `${appOrigin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { data, error } = await timing.measure("externalApiMs", () => supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, scopes: "openid email profile" },
    }));
    if (error || !data.url) throw error ?? new Error("OAUTH_REDIRECT_MISSING");
    return finalize(NextResponse.redirect(data.url, { headers: { "x-request-id": requestId } }));
  } catch {
    return finalize(NextResponse.redirect(`${appOrigin}/login?oauthError=start-failed`));
  }
}
