import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  authorizeDrAccessRequest,
  resolveDrAccessMode,
  verifyCloudflareAccessJwt,
} from "./cloudflare-access";

const environment = {
  DR_ACCESS_ENFORCEMENT_ENABLED: "true",
  DR_ACCESS_HOSTNAME: "dr.qidaigo.com",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://qidaigo.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: "a".repeat(64),
};

describe("DR Access routing", () => {
  it("leaves ordinary Production traffic unchanged", () => {
    expect(resolveDrAccessMode("app.qidaigo.com", {})).toBe("none");
  });

  it("routes only the configured custom hostname through Cloudflare Access", () => {
    expect(resolveDrAccessMode("dr.qidaigo.com", environment)).toBe("cloudflare-access");
    expect(resolveDrAccessMode("stallorder-dr-abc.vercel.app", environment)).toBe(
      "vercel-standard",
    );
    expect(resolveDrAccessMode("unexpected.qidaigo.com", environment)).toBe("reject");
  });

  it("fails closed when the Access JWT is absent", async () => {
    await expect(authorizeDrAccessRequest({
      hostname: "dr.qidaigo.com",
      headers: new Headers(),
      environment,
    })).resolves.toBe(false);
  });
});

describe("Cloudflare Access JWT validation", () => {
  it("verifies signature, issuer and application audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    const token = await new SignJWT({ email: "operator@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN)
      .setAudience(environment.CLOUDFLARE_ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const keySet = createLocalJWKSet({ keys: [publicJwk] });

    await expect(verifyCloudflareAccessJwt(token, {
      teamDomain: environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
      audience: environment.CLOUDFLARE_ACCESS_AUD,
      keySet,
    })).resolves.toMatchObject({ email: "operator@example.com" });

    await expect(verifyCloudflareAccessJwt(token, {
      teamDomain: environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
      audience: "b".repeat(64),
      keySet,
    })).rejects.toThrow();
  });
});
