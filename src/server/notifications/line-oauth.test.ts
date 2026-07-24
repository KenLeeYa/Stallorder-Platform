import { describe, expect, it, vi } from "vitest";
import { exchangeAndVerifyLineAuthorization, LineOauthError } from "./line-oauth";

describe("LINE OAuth", () => {
  it("exchanges a PKCE code and verifies audience, nonce and expiry", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        access_token: "temporary-access-token",
        expires_in: 2592000,
        id_token: "signed-id-token",
        token_type: "Bearer",
      }))
      .mockResolvedValueOnce(Response.json({
        iss: "https://access.line.me",
        sub: "Urecipient",
        aud: "1234567890",
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: "nonce-value-at-least-sixteen",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(exchangeAndVerifyLineAuthorization({
      code: "authorization-code",
      channelId: "1234567890",
      channelSecret: "login-channel-secret",
      redirectUri: "https://staging.example/api/public/line/callback",
      codeVerifier: "a".repeat(43),
      nonce: "nonce-value-at-least-sixteen",
      fetchImpl,
    })).resolves.toEqual({ providerUserId: "Urecipient" });
  });

  it("rejects a verified token with the wrong nonce", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        access_token: "temporary-access-token",
        expires_in: 2592000,
        id_token: "signed-id-token",
        token_type: "Bearer",
      }))
      .mockResolvedValueOnce(Response.json({
        iss: "https://access.line.me",
        sub: "Urecipient",
        aud: "1234567890",
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: "wrong-nonce-value",
      }));

    await expect(exchangeAndVerifyLineAuthorization({
      code: "authorization-code",
      channelId: "1234567890",
      channelSecret: "login-channel-secret",
      redirectUri: "https://staging.example/api/public/line/callback",
      codeVerifier: "a".repeat(43),
      nonce: "expected-nonce-value-at-least-sixteen",
      fetchImpl,
    })).rejects.toBeInstanceOf(LineOauthError);
  });
});
