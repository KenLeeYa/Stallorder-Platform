import { beforeEach, describe, expect, it, vi } from "vitest";
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cloudflare-access", async (original) => ({
  ...await original<typeof import("@/lib/cloudflare-access")>(),
  verifyCloudflareAccessJwt: verify,
}));
import { authorizeDrOperatorRequest } from "./dr-operator-authorization";

const environment = {
  DR_OPERATOR_PROBE_ENABLED: "true", DR_ACCESS_ENFORCEMENT_ENABLED: "true",
  DR_ACCESS_HOSTNAME: "dr.example.com",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: "a".repeat(64),
  VERCEL: "1", VERCEL_URL: "dr-exact.vercel.app",
  DR_OPERATOR_PROBE_SECRET: "isolated-dr-test-probe-credential",
};
const request = (host = "dr.example.com", headers: HeadersInit = { "cf-access-jwt-assertion": "signed-token" }) =>
  new Request(`https://${host}/api/health/dr/operator`, { headers });

describe("DR operator authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    verify.mockResolvedValue({ type: "app", email: "operator@example.test", sub: "operator-id" });
  });
  it("accepts the policy-authorized human JWT without requiring a Primary session or database", async () => {
    expect(await authorizeDrOperatorRequest(request(), false, environment)).toBe(true);
    expect(verify).toHaveBeenCalledWith("signed-token", {
      teamDomain: environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN, audience: environment.CLOUDFLARE_ACCESS_AUD,
    });
  });
  it.each([undefined, "false"])("requires enabled DR enforcement (%s)", async (enabled) => {
    expect(await authorizeDrOperatorRequest(request(), true, { ...environment, DR_ACCESS_ENFORCEMENT_ENABLED: enabled })).toBe(false);
  });
  it("rejects a forged email header without a signed JWT", async () => {
    expect(await authorizeDrOperatorRequest(request("dr.example.com", { "cf-access-authenticated-user-email": "operator@example.test" }), false, environment)).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
  it("rejects signature, issuer, audience or expiry validation failures", async () => {
    verify.mockRejectedValue(new Error("JWT_INVALID"));
    expect(await authorizeDrOperatorRequest(request(), false, environment)).toBe(false);
  });
  it("does not use an application token from another host or a global session token", async () => {
    expect(await authorizeDrOperatorRequest(request("app.example.com"), true, environment)).toBe(false);
    verify.mockResolvedValue({ type: "org", email: "operator@example.test", sub: "operator-id" });
    expect(await authorizeDrOperatorRequest(request(), false, environment)).toBe(false);
  });
  it("limits an explicitly policy-authorized service token to the machine API", async () => {
    verify.mockResolvedValue({ type: "app", sub: "", common_name: "qa-token.access" });
    expect(await authorizeDrOperatorRequest(request(), false, environment)).toBe(false);
    expect(await authorizeDrOperatorRequest(request(), true, environment)).toBe(true);
  });
  it("requires both exact generated deployment host and explicit probe secret", async () => {
    expect(await authorizeDrOperatorRequest(request("dr-exact.vercel.app"), true, environment)).toBe(false);
    const headers = { "x-stallorder-dr-probe": environment.DR_OPERATOR_PROBE_SECRET };
    expect(await authorizeDrOperatorRequest(request("dr-exact.vercel.app", headers), true, environment)).toBe(true);
    expect(await authorizeDrOperatorRequest(request("dr-other.vercel.app", headers), true, environment)).toBe(false);
    expect(await authorizeDrOperatorRequest(request("dr-exact.vercel.app", headers), false, environment)).toBe(false);
    expect(await authorizeDrOperatorRequest(request("dr-exact.vercel.app", headers), true, { ...environment, VERCEL: undefined })).toBe(false);
  });
});
