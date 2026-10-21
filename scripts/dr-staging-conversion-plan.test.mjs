import { describe, expect, it } from "vitest";
import { conversionDigest, sourceFingerprintQuery, assertConversionWriteScope, stagingOwnerPolicy } from "./dr-staging-conversion-plan.mjs";

describe("DR conversion source-bound plan", () => {
  it("preserves the existing account-member and email restrictions without widening access", () => {
    const policy = { decision: "allow", include: [{ cloudflare_account_member: { account_id: "b1c70202652cd3b77dfec70e5463785f" } }],
      require: [{ email: { email: "owner@example.test" } }], exclude: [] };
    expect(stagingOwnerPolicy(policy)).toEqual(policy);
    for (const invalid of [{ ...policy, decision: "bypass" }, { ...policy, include: [{ everyone: {} }] },
      { ...policy, require: [] }, { ...policy, include: [...policy.include, { everyone: {} }] }]) {
      expect(() => stagingOwnerPolicy(invalid)).toThrow("STAGING_OWNER_POLICY_INVALID");
    }
  });
  it("refuses Primary writes and malformed Access targets before any request", () => {
    for (const [provider, path] of [
      ["supabase", "/v1/projects/eyuctbnlvnbnivwasvqr/database/query"],
      ["vercel", "/v9/projects/prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP/env"],
      ["cloudflare", "/accounts/b1c70202652cd3b77dfec70e5463785f/access/apps/other-application"],
      ["cloudflare", "/zones/8f8070a80ad4182e4af0c11a1b496968/dns_records/8c89bc337e176873f0fbb5a3ceb24150"],
    ]) expect(() => assertConversionWriteScope(provider, path, "DELETE")).toThrow("STAGING_WRITE_SCOPE_INVALID");
    expect(() => assertConversionWriteScope("supabase", "/v1/projects/daeqwtpaxcebmtwxqdkj/secrets", "POST")).not.toThrow();
    expect(() => assertConversionWriteScope("vercel", "/v13/deployments/app.qidaigo.com", "GET")).not.toThrow();
    expect(() => assertConversionWriteScope("cloudflare", "/accounts/b1c70202652cd3b77dfec70e5463785f/access/apps/9fa19a57-1d8a-42c4-8544-2edd7687074b", "PATCH"))
      .toThrow("STAGING_WRITE_SCOPE_INVALID");
  });
  it("compares original source column order with safely quoted identifiers", () => {
    const sql = sourceFingerprintQuery([{ schema: "public", name: 'test"table', columns: ["id", 'quote"column'] }]);
    expect(sql).toContain('select "id","quote""column" from "public"."test""table"');
    expect(sql).toContain("order by md5(row_to_json(t)::text)");
    expect(sql).toContain("as fingerprint");
  });
  it("rejects tables outside the qualified backup schemas", () => {
    for (const tables of [[], [{ schema: "pg_catalog", name: "pg_authid", columns: ["rolpassword"] }],
      [{ schema: "public", name: "orders", columns: [] }]]) {
      expect(() => sourceFingerprintQuery(tables)).toThrow("STAGING_TABLE_SCOPE_INVALID");
    }
  });
  it("binds snapshot changes and exact encrypted bytes", () => {
    expect(conversionDigest({ artifact: "first" })).not.toBe(conversionDigest({ artifact: "second" }));
    expect(conversionDigest(Buffer.from("fixture"))).toBe(conversionDigest("fixture"));
  });
});
