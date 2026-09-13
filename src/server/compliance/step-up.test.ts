import { describe, expect, it } from "vitest";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { verifyMfaProof } from "./step-up";
describe("signed MFA provider proofs", () => {
  it("rejects substituted identity, issuer, audience, freshness and assurance", async () => {
    const pair = await generateKeyPair("ES256");
    const key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "local-only" }] });
    const now = new Date("2026-09-13T00:00:00Z"); const seconds = now.getTime() / 1000;
    const defaults = { sub: "owner", iss: "https://fixture.invalid/auth/v1", aud: "authenticated", iat: seconds, exp: seconds + 120,
      aal: "aal2", amr: [{ method: "totp", timestamp: seconds - 20 }] };
    const options = { issuer: defaults.iss, audience: defaults.aud, key, now };
    async function token(changes = {}) { return new SignJWT({ ...defaults, ...changes }).setProtectedHeader({ alg: "ES256", kid: "local-only" }).sign(pair.privateKey); }
    await expect(verifyMfaProof(await token(), "owner", options)).resolves.toBeUndefined();
    for (const change of [{ sub: "other" }, { iss: "https://attacker.invalid/auth/v1" }, { aud: "other" }, { exp: seconds - 1 }, { aal: "aal1" },
      { amr: [{ method: "totp", timestamp: seconds - 301 }] }, { amr: [{ method: "totp", timestamp: seconds + 1 }] }, { amr: [{ method: "password", timestamp: seconds }] }]) {
      await expect(verifyMfaProof(await token(change), "owner", options)).rejects.toThrow();
    }
    const forgedPair = await generateKeyPair("ES256");
    const forged = await new SignJWT(defaults).setProtectedHeader({ alg: "ES256", kid: "local-only" }).sign(forgedPair.privateKey);
    await expect(verifyMfaProof(forged, "owner", options)).rejects.toThrow();
  });
});
