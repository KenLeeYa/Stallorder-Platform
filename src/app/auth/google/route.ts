import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, sanitizeRedirectPath } from "@/lib/security";
import { createSupabaseAuthClient, isSupabaseAuthConfigured } from "@/lib/supabase-auth";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const requestUrl = new URL(request.url);
  const next = sanitizeRedirectPath(requestUrl.searchParams.get("next"), "/");
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : requestUrl.origin;

  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(`${appOrigin}/login?oauthError=not-configured`);
  }

  const rateLimit = await checkRateLimit({
    scope: "google-oauth-start",
    identifier: hashClientIp(request),
    limit: 20,
    windowMs: 15 * 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.redirect(`${appOrigin}/login?oauthError=rate-limited`);
  }

  try {
    const supabase = await createSupabaseAuthClient();
    const redirectTo = `${appOrigin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error || !data.url) throw error ?? new Error("OAUTH_REDIRECT_MISSING");
    return NextResponse.redirect(data.url, { headers: { "x-request-id": requestId } });
  } catch {
    return NextResponse.redirect(`${appOrigin}/login?oauthError=start-failed`);
  }
}
