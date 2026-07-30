import { NextResponse } from "next/server";
import {
  getOAuthAppBaseUrl,
  getOAuthProviderMode,
  isProductionOAuthRuntime,
} from "@/server/auth/oauth/config";
import { requireOAuthStateSecret } from "@/server/auth/oauth/crypto";
import { resolveOAuthFeatureState } from "@/server/auth/oauth/feature-flags";
import { createMockAuthorizationCode } from "@/server/auth/oauth/mock-adapter";
import { parseOAuthProvider } from "@/server/auth/oauth/types";

function safeQueryValue(url: URL, name: string, minimum: number, maximum: number) {
  const value = url.searchParams.get(name);
  return value && value.length >= minimum && value.length <= maximum ? value : null;
}

export async function GET(request: Request) {
  if (isProductionOAuthRuntime()) return new NextResponse(null, { status: 404 });
  const url = new URL(request.url);
  const provider = parseOAuthProvider(url.searchParams.get("provider") ?? "");
  if (!provider || getOAuthProviderMode() !== "MOCK") {
    return new NextResponse(null, { status: 404 });
  }
  const flags = await resolveOAuthFeatureState(provider);
  if (!flags.foundation || !flags.provider || !flags.mock) {
    return new NextResponse(null, { status: 404 });
  }

  const state = safeQueryValue(url, "state", 32, 256);
  const nonce = safeQueryValue(url, "nonce", 32, 256);
  const codeChallenge = safeQueryValue(url, "code_challenge", 32, 256);
  const redirectUri = safeQueryValue(url, "redirect_uri", 10, 2048);
  const expectedRedirectUri = `${getOAuthAppBaseUrl()}/api/auth/${provider.toLowerCase()}/callback`;
  if (!state || !nonce || !codeChallenge || redirectUri !== expectedRedirectUri) {
    return NextResponse.json({ error: "Mock OIDC 請求無效。" }, { status: 400 });
  }

  const providerKey = `OAUTH_MOCK_${provider}_SUBJECT`;
  const subject = process.env[providerKey]?.trim() || `preview-${provider.toLowerCase()}-subject`;
  if (!/^[A-Za-z0-9._:-]{3,120}$/.test(subject)) {
    return NextResponse.json({ error: "Mock OIDC 設定無效。" }, { status: 503 });
  }
  const code = createMockAuthorizationCode({
    provider,
    subject,
    email: `${provider.toLowerCase()}-preview@example.invalid`,
    displayName: `${provider} Preview 使用者`,
    nonce,
    codeChallenge,
    redirectUri,
    expiresAt: Date.now() + 5 * 60_000,
  }, requireOAuthStateSecret());
  const callback = new URL(redirectUri);
  callback.searchParams.set("state", state);
  callback.searchParams.set("code", code);
  const response = NextResponse.redirect(callback);
  response.headers.set("cache-control", "no-store");
  return response;
}
