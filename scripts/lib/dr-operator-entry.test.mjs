import { describe, expect, it } from "vitest";
import {
  buildDrOperatorEntryPlan,
  missingActiveEdgeFunctions,
  validateApprovedDrOperatorEntryPlan,
  validateDrSupabaseBindings,
} from "./dr-operator-entry.mjs";

function input(overrides = {}) {
  return {
    generatedAt: "2026-09-01T00:00:00.000Z",
    source: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
      stagingTreeSha: "b".repeat(40),
    },
    drRuntime: {
      backendCode: "DR",
      backendRole: "READ_ONLY_STANDBY",
      supabaseProjectRef: "abcdefghijklmnopqrst",
      promotionEpoch: 4,
      writesEnabled: false,
      enforcementEnabled: true,
    },
    providers: {
      vercel: {
        teamId: "team_123456",
        sourceProject: { id: "prj_123456", name: "stallorder-platform" },
        targetProject: null,
        drDomainBindings: [],
        stagingDomain: {
          name: "staging.qidaigo.com",
          gitBranch: "staging",
          redirect: null,
          redirectStatusCode: null,
        },
        cnameTarget: "cname.vercel-dns.com",
        legacyCnameTarget: "6b2c35820840b357.vercel-dns-017.com",
      },
      cloudflare: {
        zoneId: "a".repeat(32),
        access: { enabled: false, reason: "NOT_ENABLED" },
        drRecords: [],
        stagingRecord: {
          id: "record-id",
          type: "CNAME",
          name: "staging.qidaigo.com",
          content: "6b2c35820840b357.vercel-dns-017.com",
          proxied: false,
          ttl: 1,
        },
      },
    },
    ...overrides,
  };
}

describe("DR operator entry plan", () => {
  it("creates a stable, non-mutating plan with exact rollback state", () => {
    const plan = buildDrOperatorEntryPlan(input());

    expect(plan).toMatchObject({
      operation: "CREATE_PROTECTED_DR_OPERATOR_ENTRY",
      changesRemoteState: false,
      target: {
        hostname: "dr.qidaigo.com",
        projectName: "stallorder-dr",
        cnameTarget: "cname.vercel-dns.com",
        protection: "VERCEL_AUTHENTICATION_ALL",
        runtime: {
          backendTarget: "DR",
          supabaseProjectRef: "abcdefghijklmnopqrst",
          promotionEpoch: 4,
          databaseRole: "READ_ONLY_STANDBY",
        },
      },
    });
    expect(plan.planDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(validateApprovedDrOperatorEntryPlan(plan)).toBe(plan);
  });

  it("rejects a writable DR backend", () => {
    const value = input();
    value.drRuntime = {
      ...value.drRuntime,
      backendRole: "ACTIVE_WRITER",
      writesEnabled: true,
    };

    expect(() => buildDrOperatorEntryPlan(value)).toThrow(
      "DR_ENTRY_NOT_READ_ONLY_STANDBY",
    );
  });

  it("rejects an existing DR domain or project instead of overwriting it", () => {
    const domain = input();
    domain.providers.vercel.drDomainBindings = [{ projectId: "prj_other" }];
    expect(() => buildDrOperatorEntryPlan(domain)).toThrow("DR_DOMAIN_ALREADY_BOUND");

    const project = input();
    project.providers.vercel.targetProject = { id: "prj_existing" };
    expect(() => buildDrOperatorEntryPlan(project)).toThrow(
      "DR_VERCEL_PROJECT_ALREADY_EXISTS",
    );
  });

  it("detects any post-review plan modification", () => {
    const plan = buildDrOperatorEntryPlan(input());
    plan.target.hostname = "other.qidaigo.com";
    expect(() => validateApprovedDrOperatorEntryPlan(plan)).toThrow(
      "DR_ENTRY_PLAN_DIGEST_MISMATCH",
    );
  });

  it("rejects a legacy DNS record that no longer matches the Vercel target", () => {
    const value = input();
    value.providers.cloudflare.stagingRecord.content = "other.vercel-dns-017.com";

    expect(() => buildDrOperatorEntryPlan(value)).toThrow(
      "LEGACY_STAGING_DNS_TARGET_INVALID",
    );
  });

  it("keeps a hostname-specific DR CNAME separate from the legacy rollback target", () => {
    const value = input();
    value.providers.vercel.cnameTarget = "newtarget.vercel-dns-018.com";

    const plan = buildDrOperatorEntryPlan(value);

    expect(plan.target.cnameTarget).toBe("newtarget.vercel-dns-018.com");
    expect(plan.before.legacyStaging.cloudflare.content).toBe(
      "6b2c35820840b357.vercel-dns-017.com",
    );
  });
});

describe("DR operator runtime bindings", () => {
  it("accepts only URLs derived from the Plan-bound DR project", () => {
    expect(() => validateDrSupabaseBindings({
      expectedProjectRef: "abcdefghijklmnopqrst",
      actualProjectRef: "abcdefghijklmnopqrst",
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co/",
      functionsUrl: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/",
    })).not.toThrow();

    expect(() => validateDrSupabaseBindings({
      expectedProjectRef: "abcdefghijklmnopqrst",
      actualProjectRef: "abcdefghijklmnopqrst",
      supabaseUrl: "https://primaryprimaryprimary.supabase.co",
      functionsUrl: "https://primaryprimaryprimary.supabase.co/functions/v1",
    })).toThrow("DR_ENTRY_SUPABASE_URL_MISMATCH");
  });

  it("detects a missing or inactive Edge Function", () => {
    expect(missingActiveEdgeFunctions(
      ["orders", "payments", "webhooks"],
      [
        { slug: "orders", status: "ACTIVE" },
        { name: "payments", status: "INACTIVE" },
        { name: "webhooks", status: "ACTIVE" },
      ],
    )).toEqual(["payments"]);
  });
});
