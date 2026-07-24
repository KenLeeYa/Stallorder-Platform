import {
  lineOauthTokenResponseSchema,
  lineVerifiedIdTokenSchema,
} from "@/lib/line-notification-contract";

export class LineOauthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LineOauthError";
  }
}

export async function exchangeAndVerifyLineAuthorization(input: {
  code: string;
  channelId: string;
  channelSecret: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.channelId,
    client_secret: input.channelSecret,
    code_verifier: input.codeVerifier,
  });
  const tokenResponse = await fetchImpl("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenBody,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const tokenPayload = lineOauthTokenResponseSchema.safeParse(await tokenResponse.json().catch(() => null));
  if (!tokenResponse.ok || !tokenPayload.success) throw new LineOauthError("LINE_OAUTH_EXCHANGE_FAILED");

  const verifyResponse = await fetchImpl("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: tokenPayload.data.id_token,
      client_id: input.channelId,
      nonce: input.nonce,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const verified = lineVerifiedIdTokenSchema.safeParse(await verifyResponse.json().catch(() => null));
  if (
    !verifyResponse.ok
    || !verified.success
    || verified.data.aud !== input.channelId
    || verified.data.nonce !== input.nonce
    || verified.data.exp * 1000 <= Date.now()
  ) {
    throw new LineOauthError("LINE_ID_TOKEN_INVALID");
  }

  await fetchImpl("https://api.line.me/oauth2/v2.1/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: tokenPayload.data.access_token,
      client_id: input.channelId,
      client_secret: input.channelSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

  return { providerUserId: verified.data.sub };
}
