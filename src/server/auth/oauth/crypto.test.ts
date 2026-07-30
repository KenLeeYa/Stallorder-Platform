import { describe, expect, it } from "vitest";
import {
  createPkceChallenge,
  createPkceVerifier,
  decryptOAuthValue,
  encryptOAuthValue,
  hashOAuthEvidence,
  requireOAuthStateSecret,
} from "./crypto";

const secret = "test-only-oauth-state-secret-with-more-than-32-characters";

describe("OAuth transaction cryptography", () => {
  it("encrypts and authenticates server-side transaction values", () => {
    const encrypted = encryptOAuthValue("sensitive-verifier", secret);
    expect(encrypted).not.toContain("sensitive-verifier");
    expect(decryptOAuthValue(encrypted, secret)).toBe("sensitive-verifier");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptOAuthValue("sensitive-verifier", secret);
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("a") ? "b" : "a"}`;
    expect(() => decryptOAuthValue(tampered, secret))
      .toThrow("OAUTH_CIPHERTEXT_INVALID");
  });

  it("creates PKCE S256 evidence without returning the verifier", () => {
    const verifier = createPkceVerifier();
    const challenge = createPkceChallenge(verifier);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
    expect(createPkceChallenge(verifier)).toBe(challenge);
  });

  it("hashes callback evidence deterministically", () => {
    expect(hashOAuthEvidence("one-time-code")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOAuthEvidence("one-time-code")).toBe(hashOAuthEvidence("one-time-code"));
  });

  it("fails closed when the state secret is missing or weak", () => {
    expect(() => requireOAuthStateSecret({} as NodeJS.ProcessEnv))
      .toThrow("OAUTH_STATE_SECRET_MISSING");
    expect(() => requireOAuthStateSecret({
      NODE_ENV: "test",
      OAUTH_STATE_SECRET: "too-short",
    } as NodeJS.ProcessEnv)).toThrow("OAUTH_STATE_SECRET_MISSING");
  });
});
