import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildLineAuthorizationUrl,
  createLinePkce,
  verifyLineWebhookSignature,
} from "./line-security";

describe("LINE security helpers", () => {
  it("verifies the signature against the unmodified raw body", () => {
    const body = '{"destination":"Ubot","events":[]}';
    const secret = "test-channel-secret";
    const signature = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyLineWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyLineWebhookSignature(`${body}\n`, signature, secret)).toBe(false);
    expect(verifyLineWebhookSignature(body, null, secret)).toBe(false);
  });

  it("creates PKCE S256 values and a constrained LINE authorization URL", () => {
    const pkce = createLinePkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const url = new URL(buildLineAuthorizationUrl({
      channelId: "1234567890",
      redirectUri: "https://staging.example/api/public/line/callback",
      state: "state-token",
      nonce: "nonce-token",
      codeChallenge: pkce.challenge,
    }));
    expect(url.origin).toBe("https://access.line.me");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("nonce")).toBe("nonce-token");
  });
});
