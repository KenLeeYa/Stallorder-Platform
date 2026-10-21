import { describe, expect, it } from "vitest";
import { stagingAccessConfiguration, assertStagingAccessReadback } from "./staging-access-entry.mjs";
import { STAGING_TARGET } from "./dr-staging-conversion-plan.mjs";

const owner = { decision: "allow", include: [{ cloudflare_account_member: { account_id: STAGING_TARGET.account } }],
  require: [{ email: { email: "owner@example.test" } }], exclude: [] };

describe("protected Staging entry", () => {
  it("retains member plus owner restriction and limits machine QA to its exact token", () => {
    const body = stagingAccessConfiguration({ owner, idpId: "idp-test", tokenId: "qa-token", sourceSha: "a".repeat(40) });
    expect(body.domain).toBe("staging.qidaigo.com");
    expect(body.allowed_idps).toEqual(["idp-test"]);
    expect(body.policies[0]).toMatchObject(owner);
    expect(body.policies[1]).toMatchObject({ decision: "non_identity", include: [{ service_token: { token_id: "qa-token" } }] });
    expect(JSON.stringify(body)).not.toMatch(/bypass|everyone/);
  });
  it("rejects any broadened policy or a different hostname on readback", () => {
    const body = stagingAccessConfiguration({ owner, idpId: "idp-test", tokenId: "qa-token", sourceSha: "a".repeat(40) });
    const app = { ...body, id: "access-test", aud: "a".repeat(64) };
    expect(() => assertStagingAccessReadback(app, body.policies, body)).not.toThrow();
    expect(() => assertStagingAccessReadback({ ...app, domain: "app.qidaigo.com" }, body.policies, body)).toThrow();
    expect(() => assertStagingAccessReadback(app, [...body.policies, { decision: "bypass" }], body)).toThrow();
    const widened = [{ ...body.policies[0], require: [] }, body.policies[1]];
    expect(() => assertStagingAccessReadback(app, widened, body)).toThrow();
  });
});
