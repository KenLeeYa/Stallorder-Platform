import { NextResponse } from "next/server";
import { getRequestPrincipal, setSessionCookies } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { getRequestDeviceLabel } from "@/lib/device-label";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  hashClientIp,
  hashClientUserAgent,
  resolveSessionDeviceId,
  sanitizeRedirectPath,
} from "@/lib/security";
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";
import { getOAuthAppBaseUrl } from "@/server/auth/oauth/config";
import { completeOAuthLogin } from "@/server/auth/oauth/identity-service";
import { getEnabledOAuthProviderAdapter } from "@/server/auth/oauth/provider-registry";
import {
  claimOAuthTransaction,
  markOAuthTransactionFailed,
  type ClaimedOAuthTransaction,
} from "@/server/auth/oauth/transaction-service";
import { parseOAuthProvider } from "@/server/auth/oauth/types";
import { getPendingMerchantSetupPath } from "@/server/merchant-applications/merchant-setup-service";

type RouteContext = { params: Promise<{ provider: string }> };
type CallbackInput = {
  code: string | null;
  state: string | null;
  providerError: string | null;
  firstPartyUser?: string;
};

function callbackErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "";
  return /^OAUTH_[A-Z0-9_]{1,70}$/.test(value) ? value : "OAUTH_CALLBACK_FAILED";
}

async function readPostCallback(request: Request): Promise<CallbackInput | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    contentType !== "application/x-www-form-urlencoded"
    || contentLength > 16_384
  ) return null;
  const body = await request.text();
  if (body.length > 16_384) return null;
  const params = new URLSearchParams(body);
  return {
    code: params.get("code"),
    state: params.get("state"),
    providerError: params.get("error"),
    firstPartyUser: params.get("user") ?? undefined,
  };
}

function readGetCallback(request: Request): CallbackInput {
  const params = new URL(request.url).searchParams;
  return {
    code: params.get("code"),
    state: params.get("state"),
    providerError: params.get("error"),
  };
}

async function recentLinkPrincipal(
  request: Request,
  claimed: Extract<ClaimedOAuthTransaction, { status: "CLAIMED" }>,
) {
  if (!claimed.currentProfileId) return undefined;
  const principal = await getRequestPrincipal(request);
  if (!principal || principal.user.id !== claimed.currentProfileId) {
    throw new Error("OAUTH_IDENTITY_LINK_SESSION_MISMATCH");
  }
  const session = await prisma.authSession.findUnique({
    where: { id: principal.sessionId },
    select: { issuedAt: true, revokedAt: true },
  });
  if (
    !session
    || session.revokedAt
    || session.issuedAt < new Date(Date.now() - 10 * 60_000)
  ) {
    throw new Error("OAUTH_IDENTITY_LINK_STEP_UP_REQUIRED");
  }
  return principal.user.id;
}

async function callback(
  request: Request,
  context: RouteContext,
  input: CallbackInput | null,
) {
  const requestId = createRequestId();
  const provider = parseOAuthProvider((await context.params).provider);
  if (!provider || !input) {
    return NextResponse.json(
      { error: "OAuth Callback 格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
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

  const appOrigin = getOAuthAppBaseUrl();
  if (input.providerError || !input.code || !input.state) {
    await recordAuditEvent({
      action: "OAUTH_LOGIN_FAILED",
      entityType: "AUTH",
      outcome: "FAILURE",
      requestId,
      ipHash,
      metadata: {
        provider,
        reason: input.providerError ? "PROVIDER_DENIED" : "CALLBACK_INPUT_MISSING",
      },
    });
    return NextResponse.redirect(`${appOrigin}/login?oauthError=callback-failed`);
  }

  const limit = await checkRateLimit({
    scope: `oauth-callback-${provider.toLowerCase()}`,
    identifier: ipHash,
    limit: 30,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "登入驗證次數過多，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  let claimed: ClaimedOAuthTransaction | null = null;
  try {
    claimed = await claimOAuthTransaction({
      provider,
      state: input.state,
      authorizationCode: input.code,
      circuitSource: "B",
    });
    if (claimed.status === "COMPLETED") {
      const principal = await getRequestPrincipal(request);
      const destination = principal?.sessionId === claimed.resultSessionId
        ? sanitizeRedirectPath(claimed.returnTo, "/")
        : "/login?oauthError=already-completed";
      return NextResponse.redirect(`${appOrigin}${destination}`);
    }

    const adapter = await getEnabledOAuthProviderAdapter(provider);
    const claims = await adapter.exchangeAndVerify({
      code: input.code,
      codeVerifier: claimed.codeVerifier,
      expectedNonce: claimed.nonce,
      redirectUri: claimed.redirectUri,
      firstPartyUser: input.firstPartyUser,
    });
    const authenticatedProfileId = await recentLinkPrincipal(request, claimed);
    const deviceId = resolveSessionDeviceId(request);
    const result = await completeOAuthLogin({
      transactionId: claimed.id,
      claims,
      authenticatedProfileId,
      requestId,
      sessionEvidence: {
        deviceId,
        deviceLabel: getRequestDeviceLabel(request),
        ipHash,
        userAgentHash: hashClientUserAgent(request),
      },
    });

    const [workspaces, pendingSetupPath] = await Promise.all([
      getWorkspaceAccess(result.profile.id, result.profile.platformRole),
      getPendingMerchantSetupPath(result.profile.id),
    ]);
    const fallback = result.linkMode
      ? "/select-organization"
      : result.profile.platformRole === "PLATFORM_ADMIN"
        ? "/admin/billing"
        : pendingSetupPath
          ? pendingSetupPath
          : workspaces.length > 0
            ? getDefaultWorkspacePath(workspaces)
            : "/onboarding?oauth=1";
    const destination = result.returnTo === "/"
      ? fallback
      : sanitizeRedirectPath(result.returnTo, fallback);
    const response = NextResponse.redirect(`${appOrigin}${destination}`);
    setSessionCookies(response, result.session, deviceId);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    if (claimed?.status === "CLAIMED") {
      await markOAuthTransactionFailed(claimed.id);
    }
    await recordAuditEvent({
      action: "OAUTH_LOGIN_FAILED",
      entityType: "OAUTH_TRANSACTION",
      entityId: claimed?.id,
      outcome: "FAILURE",
      requestId,
      ipHash,
      metadata: {
        provider,
        reason: callbackErrorCode(error),
      },
    });
    return NextResponse.redirect(`${appOrigin}/login?oauthError=callback-failed`);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return callback(request, context, readGetCallback(request));
}

export async function POST(request: Request, context: RouteContext) {
  const provider = parseOAuthProvider((await context.params).provider);
  if (provider !== "APPLE") {
    return NextResponse.json({ error: "不支援的 Callback Method。" }, { status: 405 });
  }
  return callback(request, context, await readPostCallback(request));
}
