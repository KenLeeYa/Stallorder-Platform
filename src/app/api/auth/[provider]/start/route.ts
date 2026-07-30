import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  hashClientIp,
  sanitizeRedirectPath,
} from "@/lib/security";
import {
  getEnabledOAuthProviderAdapter,
  getOAuthRedirectUri,
} from "@/server/auth/oauth/provider-registry";
import { createOAuthTransaction } from "@/server/auth/oauth/transaction-service";
import { parseOAuthProvider } from "@/server/auth/oauth/types";

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = createRequestId();
  const provider = parseOAuthProvider((await params).provider);
  if (!provider) {
    return NextResponse.json(
      { error: "不支援的登入方式。" },
      { status: 404, headers: { "x-request-id": requestId } },
    );
  }

  let ipHash: string;
  try {
    ipHash = hashClientIp(request);
  } catch {
    return NextResponse.json(
      { error: "目前無法驗證登入來源。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
  const limit = await checkRateLimit({
    scope: `oauth-start-${provider.toLowerCase()}`,
    identifier: ipHash,
    limit: 20,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "登入嘗試次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  try {
    const adapter = await getEnabledOAuthProviderAdapter(provider);
    const redirectUri = getOAuthRedirectUri(provider);
    const returnTo = sanitizeRedirectPath(
      new URL(request.url).searchParams.get("next"),
      "/",
    );
    const transaction = await createOAuthTransaction({
      provider,
      redirectUri,
      returnTo,
    });
    const authorizationUrl = await adapter.buildAuthorizationUrl({
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: transaction.codeChallenge,
      redirectUri,
    });
    await recordAuditEvent({
      action: "OAUTH_LOGIN_STARTED",
      entityType: "OAUTH_TRANSACTION",
      entityId: transaction.transactionId,
      outcome: "SUCCESS",
      requestId,
      ipHash,
      metadata: { provider },
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-request-id", requestId);
    return response;
  } catch {
    await recordAuditEvent({
      action: "OAUTH_LOGIN_FAILED",
      entityType: "AUTH",
      outcome: "FAILURE",
      requestId,
      ipHash,
      metadata: { provider, reason: "PROVIDER_UNAVAILABLE" },
    });
    return NextResponse.json(
      { error: "此登入方式目前尚未開放。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}
