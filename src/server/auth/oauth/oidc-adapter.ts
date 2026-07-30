import "server-only";

import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { z } from "zod";
import { safeEqual } from "@/lib/security";
import type { LiveOAuthProviderConfig } from "./config";
import type {
  OAuthAuthorizationInput,
  OAuthExchangeInput,
  OAuthIdentityClaims,
  OAuthProviderAdapter,
} from "./types";

const tokenResponseSchema = z.object({
  id_token: z.string().min(20).max(16_384),
}).passthrough();

const appleFirstPartyUserSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  name: z.object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
  }).strict().optional(),
}).strict();

const appleAccountEventSchema = z.object({
  type: z.string().min(1).max(200),
  sub: z.string().min(1).max(255),
  event_time: z.union([z.number(), z.string()]).optional(),
}).passthrough();

type FetchImplementation = typeof fetch;

function claimString(payload: JWTPayload, key: string, maxLength: number) {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\r\n]/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function normalizedEmail(payload: JWTPayload) {
  const email = claimString(payload, "email", 320)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

function verifiedEmail(payload: JWTPayload) {
  const value = payload.email_verified;
  return value === true || value === "true";
}

function avatarUrl(payload: JWTPayload) {
  const picture = claimString(payload, "picture", 2048);
  if (!picture) return null;
  try {
    const parsed = new URL(picture);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function appleFirstPartyProfile(value: unknown) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const parsed = appleFirstPartyUserSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const displayName = [
      parsed.data.name?.firstName,
      parsed.data.name?.lastName,
    ].filter(Boolean).join(" ").trim();
    return {
      email: parsed.data.email?.toLowerCase() ?? null,
      displayName: displayName || null,
    };
  } catch {
    return null;
  }
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (text.length > 64_000) throw new Error("OAUTH_PROVIDER_RESPONSE_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("OAUTH_PROVIDER_RESPONSE_INVALID");
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchImplementation,
  input: string,
  init: RequestInit,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw new Error("OAUTH_PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export class OidcProviderAdapter implements OAuthProviderAdapter {
  readonly provider;
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(
    private readonly config: LiveOAuthProviderConfig,
    private readonly fetchImpl: FetchImplementation = fetch,
    keyResolver?: JWTVerifyGetKey,
  ) {
    this.provider = config.provider;
    this.keyResolver = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUri), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }

  async buildAuthorizationUrl(input: OAuthAuthorizationInput) {
    if (input.redirectUri !== this.config.redirectUri) {
      throw new Error("OAUTH_REDIRECT_URI_MISMATCH");
    }
    const url = new URL(this.config.authorizationEndpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scopes.join(" "));
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);

    if (this.provider !== "APPLE") {
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    } else {
      url.searchParams.set("response_mode", "form_post");
    }
    return url;
  }

  async exchangeAndVerify(input: OAuthExchangeInput): Promise<OAuthIdentityClaims> {
    if (input.redirectUri !== this.config.redirectUri) {
      throw new Error("OAUTH_REDIRECT_URI_MISMATCH");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.config.clientId,
    });

    if (this.provider !== "APPLE") {
      body.set("client_secret", this.config.clientSecret);
      body.set("code_verifier", input.codeVerifier);
    } else {
      body.set("client_secret", await this.createAppleClientSecret());
    }

    const response = await fetchWithTimeout(this.fetchImpl, this.config.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
    });
    if (!response.ok) throw new Error("OAUTH_CODE_EXCHANGE_FAILED");

    const tokenResponse = tokenResponseSchema.safeParse(await readJsonResponse(response));
    if (!tokenResponse.success) throw new Error("OAUTH_TOKEN_RESPONSE_INVALID");
    const { payload } = await jwtVerify(tokenResponse.data.id_token, this.keyResolver, {
      issuer: this.config.issuer,
      audience: this.config.clientId,
      algorithms: ["RS256"],
      clockTolerance: 5,
      maxTokenAge: "10 minutes",
    });
    this.validateClaims(payload, input.expectedNonce);

    const firstParty = this.provider === "APPLE"
      ? appleFirstPartyProfile(input.firstPartyUser)
      : null;
    const email = normalizedEmail(payload) ?? firstParty?.email ?? null;
    const displayName = claimString(payload, "name", 200) ?? firstParty?.displayName ?? null;
    const locale = claimString(payload, "locale", 35);
    const isPrivateEmail = payload.is_private_email;
    const metadata: Record<string, string> = {};
    if (locale) metadata.locale = locale;
    if (isPrivateEmail === true || isPrivateEmail === "true") {
      metadata.isPrivateEmail = "true";
    }

    return {
      provider: this.provider,
      subject: payload.sub as string,
      email,
      emailVerified: verifiedEmail(payload),
      displayName,
      avatarUrl: avatarUrl(payload),
      metadata,
    };
  }

  async verifyAccountEvent(signedPayload: string) {
    if (this.provider !== "APPLE" || signedPayload.length > 32_000) {
      throw new Error("OAUTH_ACCOUNT_EVENT_INVALID");
    }
    const { payload } = await jwtVerify(signedPayload, this.keyResolver, {
      issuer: this.config.issuer,
      audience: this.config.clientId,
      algorithms: ["RS256"],
      clockTolerance: 5,
      maxTokenAge: "24 hours",
    });
    let accountEvent: z.infer<typeof appleAccountEventSchema>;
    try {
      accountEvent = appleAccountEventSchema.parse(
        typeof payload.events === "string"
          ? JSON.parse(payload.events)
          : payload.events,
      );
    } catch {
      throw new Error("OAUTH_ACCOUNT_EVENT_INVALID");
    }
    const eventTimestamp = Number(accountEvent.event_time);
    const occurredAt = Number.isFinite(eventTimestamp)
      ? new Date(eventTimestamp > 10_000_000_000 ? eventTimestamp : eventTimestamp * 1000)
      : new Date((payload.iat as number) * 1000);
    if (Number.isNaN(occurredAt.getTime())) throw new Error("OAUTH_ACCOUNT_EVENT_INVALID");
    return {
      subject: accountEvent.sub,
      eventType: accountEvent.type,
      occurredAt,
    };
  }

  private validateClaims(payload: JWTPayload, expectedNonce: string) {
    if (
      !payload.sub
      || payload.sub.length > 255
      || typeof payload.iat !== "number"
      || typeof payload.exp !== "number"
      || typeof payload.nonce !== "string"
      || !safeEqual(payload.nonce, expectedNonce)
    ) {
      throw new Error("OAUTH_ID_TOKEN_INVALID");
    }
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (
      audience.length > 1
      && (typeof payload.azp !== "string" || payload.azp !== this.config.clientId)
    ) {
      throw new Error("OAUTH_ID_TOKEN_AZP_INVALID");
    }
  }

  private async createAppleClientSecret() {
    if (!this.config.apple) throw new Error("OAUTH_APPLE_CONFIG_MISSING");
    try {
      const key = await importPKCS8(this.config.apple.privateKey, "ES256");
      return await new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: this.config.apple.keyId })
        .setIssuer(this.config.apple.teamId)
        .setSubject(this.config.clientId)
        .setAudience("https://appleid.apple.com")
        .setIssuedAt()
        .setExpirationTime("5 minutes")
        .sign(key);
    } catch {
      throw new Error("OAUTH_APPLE_CLIENT_SECRET_FAILED");
    }
  }
}
