import { describe, expect, it } from "vitest";
import {
  assertVercelDeploymentProjectIsolation,
  buildDrOperatorEntryPlan,
  buildVercelCliEnvironment,
  classifyExclusiveVercelDomainSet,
  classifyDirectVercelTlsResponse,
  isPlanOwnedDrDeployment,
  missingActiveEdgeFunctions,
  primaryVercelStateMatches,
  sanitizeProviderErrorCode,
  validateApprovedDrOperatorEntryPlan,
  validateCloudflareAccessApplicationsPage,
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
        primary: {
          hostname: "app.qidaigo.com",
          alias: {
            uid: "primary-alias-id",
            hostname: "app.qidaigo.com",
            projectId: "prj_123456",
            deploymentId: "dpl_primary",
            deploymentUrl: "stallorder-platform-primary.vercel.app",
          },
          deployment: {
            id: "dpl_primary",
            url: "stallorder-platform-primary.vercel.app",
            projectId: "prj_123456",
            name: "stallorder-platform",
            target: "production",
            readyState: "READY",
          },
          healthStatus: 200,
        },
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
        accountId: "c".repeat(32),
        zoneId: "a".repeat(32),
        access: {
          enabled: true,
          teamDomain: "https://qidaigo.cloudflareaccess.com",
          identityProvider: {
            id: "cloudflare-idp-id",
            type: "cloudflare",
            restrictToAccountMembers: true,
          },
          applications: [],
          serviceTokens: [],
        },
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
        dnsProxy: true,
        protection: "CLOUDFLARE_ACCESS_PLUS_VERCEL_STANDARD",
        vercelDeploymentProtection: "all_except_custom_domains",
        cloudflareAccess: {
          teamDomain: "https://qidaigo.cloudflareaccess.com",
          identityProviderId: "cloudflare-idp-id",
          humanSelector: "cloudflare_account_member",
          qaServiceTokenDuration: "1h",
        },
        runtime: {
          backendTarget: "DR",
          supabaseProjectRef: "abcdefghijklmnopqrst",
          promotionEpoch: 4,
          databaseRole: "READ_ONLY_STANDBY",
        },
      },
      before: {
        primary: {
          hostname: "app.qidaigo.com",
          alias: {
            projectId: "prj_123456",
            deploymentId: "dpl_primary",
          },
          deployment: {
            id: "dpl_primary",
            projectId: "prj_123456",
            target: "production",
            readyState: "READY",
          },
          healthStatus: 200,
        },
      },
    });
    expect(plan.planDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.applySteps).toContain(
      "bind dr.qidaigo.com, promote the exact staged deployment, create its Cloudflare CNAME as DNS-only, prove direct Vercel HTTPS readiness, then enable the proxy",
    );
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

  it("rejects an unhealthy or misbound Primary before creating a DR Plan", () => {
    const unhealthy = input();
    unhealthy.providers.vercel.primary.healthStatus = 403;
    expect(() => buildDrOperatorEntryPlan(unhealthy)).toThrow(
      "DR_ENTRY_PRIMARY_HEALTH_NOT_READY",
    );

    const wrongProject = input();
    wrongProject.providers.vercel.primary.deployment.projectId = "prj_other";
    expect(() => buildDrOperatorEntryPlan(wrongProject)).toThrow(
      "DR_ENTRY_PRIMARY_PROJECT_IDENTITY_MISMATCH",
    );

    const wrongDeployment = input();
    wrongDeployment.providers.vercel.primary.alias.deploymentId = "dpl_other";
    expect(() => buildDrOperatorEntryPlan(wrongDeployment)).toThrow(
      "DR_ENTRY_PRIMARY_DEPLOYMENT_IDENTITY_MISMATCH",
    );

    const historicalDrDeployment = input();
    historicalDrDeployment.providers.vercel.primary.deployment.backendTarget = "DR";
    historicalDrDeployment.providers.vercel.primary.deployment.sourceCommit = "c".repeat(40);
    expect(() => buildDrOperatorEntryPlan(historicalDrDeployment)).toThrow(
      "DR_ENTRY_PRIMARY_BACKEND_IDENTITY_INVALID",
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

  it("requires enabled Cloudflare Access with the account-member IdP", () => {
    const disabled = input();
    disabled.providers.cloudflare.access = { enabled: false, reason: "NOT_ENABLED" };
    expect(() => buildDrOperatorEntryPlan(disabled)).toThrow(
      "DR_ENTRY_CLOUDFLARE_ACCESS_NOT_ENABLED",
    );

    const unrestricted = input();
    unrestricted.providers.cloudflare.access.identityProvider.restrictToAccountMembers = false;
    expect(() => buildDrOperatorEntryPlan(unrestricted)).toThrow(
      "DR_ENTRY_CLOUDFLARE_ACCOUNT_IDP_INVALID",
    );
  });

  it("rejects an existing Access application or colliding QA token", () => {
    const application = input();
    application.providers.cloudflare.access.applications = [{
      id: "access-app-id",
      name: "StallOrder Production DR Operator",
      domain: "dr.qidaigo.com",
    }];
    expect(() => buildDrOperatorEntryPlan(application)).toThrow(
      "DR_ENTRY_ACCESS_APPLICATION_ALREADY_EXISTS",
    );

    const token = input();
    token.providers.cloudflare.access.serviceTokens = [{
      id: "service-token-id",
      name: "stallorder-dr-qa-aaaaaaaaaaaa",
    }];
    expect(() => buildDrOperatorEntryPlan(token)).toThrow(
      "DR_ENTRY_QA_SERVICE_TOKEN_ALREADY_EXISTS",
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

describe("DR operator provider diagnostics", () => {
  it("overrides an inherited Production project for every Vercel CLI command", () => {
    expect(buildVercelCliEnvironment({
      baseEnv: {
        VERCEL_ORG_ID: "team_inherited",
        VERCEL_PROJECT_ID: "prj_production",
        UNRELATED_VALUE: "preserved",
      },
      vercelTeamId: "team_stallorder",
      projectId: "prj_dr",
    })).toMatchObject({
      VERCEL_ORG_ID: "team_stallorder",
      VERCEL_PROJECT_ID: "prj_dr",
      UNRELATED_VALUE: "preserved",
    });
    expect(() => buildVercelCliEnvironment({
      baseEnv: {},
      vercelTeamId: "invalid",
      projectId: "prj_dr",
    })).toThrow("DR_ENTRY_VERCEL_CLI_TEAM_INVALID");
    expect(() => buildVercelCliEnvironment({
      baseEnv: {},
      vercelTeamId: "team_stallorder",
      projectId: "invalid",
    })).toThrow("DR_ENTRY_VERCEL_CLI_PROJECT_INVALID");
  });

  it("requires each DR deployment to belong only to the new target project", () => {
    expect(() => assertVercelDeploymentProjectIsolation({
      sourceProjectId: "prj_source",
      targetProjectId: "prj_target",
      expectedDeploymentUrl: "stallorder-dr-target.vercel.app",
      expectedProjectName: "stallorder-dr",
      deployment: {
        id: "dpl_target",
        projectId: "prj_target",
        url: "stallorder-dr-target.vercel.app",
        name: "stallorder-dr",
        target: "production",
        readyState: "READY",
      },
    })).not.toThrow();
    expect(() => assertVercelDeploymentProjectIsolation({
      sourceProjectId: "prj_source",
      targetProjectId: "prj_source",
      expectedDeploymentUrl: "stallorder-dr-source.vercel.app",
      expectedProjectName: "stallorder-dr",
      deployment: {
        id: "dpl_source",
        projectId: "prj_source",
        url: "stallorder-dr-source.vercel.app",
        name: "stallorder-dr",
        target: "production",
        readyState: "READY",
      },
    })).toThrow("DR_ENTRY_TARGET_PROJECT_COLLIDES_WITH_SOURCE");
    expect(() => assertVercelDeploymentProjectIsolation({
      sourceProjectId: "prj_source",
      targetProjectId: "prj_target",
      expectedDeploymentUrl: "stallorder-dr-source.vercel.app",
      expectedProjectName: "stallorder-dr",
      deployment: {
        id: "dpl_source",
        projectId: "prj_source",
        url: "stallorder-dr-source.vercel.app",
        name: "stallorder-dr",
        target: "production",
        readyState: "READY",
      },
    })).toThrow("DR_ENTRY_DEPLOYMENT_PROJECT_MISMATCH");
    expect(() => assertVercelDeploymentProjectIsolation({
      sourceProjectId: "prj_source",
      targetProjectId: "prj_target",
      expectedDeploymentUrl: "stallorder-dr-target.vercel.app",
      expectedProjectName: "stallorder-dr",
      deployment: {
        id: "dpl_target",
        projectId: "prj_target",
        url: "stallorder-dr-target.vercel.app",
        name: "stallorder-dr",
        target: null,
        readyState: "READY",
      },
    })).toThrow("DR_ENTRY_DEPLOYMENT_READBACK_INVALID");
  });

  it("detects any change to the Plan-bound Primary alias or deployment", () => {
    const expected = input().providers.vercel.primary;
    expect(primaryVercelStateMatches(expected, structuredClone(expected))).toBe(true);

    const changed = structuredClone(expected);
    changed.alias.deploymentId = "dpl_other";
    expect(primaryVercelStateMatches(expected, changed)).toBe(false);

    const replacementAliasRecord = structuredClone(expected);
    replacementAliasRecord.alias.uid = "replacement-provider-alias-id";
    expect(primaryVercelStateMatches(expected, replacementAliasRecord)).toBe(true);
  });

  it("attributes a Primary rollback only to the current Plan's DR deployment", () => {
    const plan = {
      source: { commitSha: "a".repeat(40) },
      target: { sourceProjectId: "prj_source" },
      planDigest: "b".repeat(64),
    };
    const current = {
      hostname: "app.qidaigo.com",
      alias: {
        hostname: "app.qidaigo.com",
        projectId: "prj_source",
        deploymentId: "dpl_dr",
        deploymentUrl: "stallorder-dr.vercel.app",
      },
      deployment: {
        id: "dpl_dr",
        url: "stallorder-dr.vercel.app",
        projectId: "prj_source",
        backendTarget: "DR",
        sourceCommit: "a".repeat(40),
        drPlanDigest: "b".repeat(64),
      },
    };
    expect(isPlanOwnedDrDeployment(plan, structuredClone(current))).toBe(true);

    const unrelatedPlan = structuredClone(current);
    unrelatedPlan.deployment.drPlanDigest = "c".repeat(64);
    expect(isPlanOwnedDrDeployment(plan, unrelatedPlan)).toBe(false);

    const differentCommit = structuredClone(current);
    differentCommit.deployment.sourceCommit = "d".repeat(40);
    expect(isPlanOwnedDrDeployment(plan, differentCommit)).toBe(false);

    const mismatchedAlias = structuredClone(current);
    mismatchedAlias.alias.deploymentId = "dpl_other";
    expect(isPlanOwnedDrDeployment(plan, mismatchedAlias)).toBe(false);
  });

  it("allows Vercel-managed domains while requiring the exclusive custom domain", () => {
    expect(classifyExclusiveVercelDomainSet([], "dr.qidaigo.com")).toBe("pending");
    expect(classifyExclusiveVercelDomainSet(
      [{ name: "stallorder-dr-random-animal.vercel.app" }],
      "dr.qidaigo.com",
    )).toBe("pending");
    expect(classifyExclusiveVercelDomainSet(
      [
        { name: "stallorder-dr-random-animal.vercel.app" },
        { name: "dr.qidaigo.com" },
      ],
      "dr.qidaigo.com",
    )).toBe("ready");
    expect(classifyExclusiveVercelDomainSet(
      [{ name: "other.qidaigo.com" }],
      "dr.qidaigo.com",
    )).toBe("invalid");
    expect(classifyExclusiveVercelDomainSet(
      [{ name: "dr.qidaigo.com" }, { name: "other.qidaigo.com" }],
      "dr.qidaigo.com",
    )).toBe("invalid");
    expect(classifyExclusiveVercelDomainSet(
      [{ name: "dr.qidaigo.com" }, { name: "dr.qidaigo.com" }],
      "dr.qidaigo.com",
    )).toBe("invalid");
    expect(classifyExclusiveVercelDomainSet([{}], "dr.qidaigo.com")).toBe("invalid");
  });

  it("accepts only a fail-closed DR response reached through Vercel HTTPS", () => {
    expect(classifyDirectVercelTlsResponse({
      status: 403,
      cacheControl: "no-store",
      vercelId: "hnd1::example",
      server: null,
    })).toEqual({
      ready: true,
      status: 403,
      noStore: true,
      reachedVercel: true,
    });

    expect(classifyDirectVercelTlsResponse({
      status: 525,
      cacheControl: "no-store",
      vercelId: null,
      server: "cloudflare",
    }).ready).toBe(false);
    expect(classifyDirectVercelTlsResponse({
      status: 403,
      cacheControl: null,
      vercelId: "hnd1::example",
      server: null,
    }).ready).toBe(false);
    expect(classifyDirectVercelTlsResponse({
      status: 200,
      cacheControl: "no-store",
      vercelId: "hnd1::example",
      server: null,
    }).ready).toBe(false);
  });

  it("accepts Cloudflare's empty Access application page", () => {
    expect(validateCloudflareAccessApplicationsPage({
      result: [],
      result_info: { total_pages: 0 },
    })).toEqual([]);
  });

  it("rejects malformed or unexpectedly paginated Access application pages", () => {
    expect(() => validateCloudflareAccessApplicationsPage({
      result: [{ id: "unexpected" }],
      result_info: { total_pages: 0 },
    })).toThrow("DR_ENTRY_CLOUDFLARE_ACCESS_APPLICATIONS_INVALID");
    expect(() => validateCloudflareAccessApplicationsPage({
      result: [],
      result_info: { total_pages: 2 },
    })).toThrow("DR_ENTRY_CLOUDFLARE_ACCESS_APPLICATIONS_INVALID");
  });

  it("keeps only a short provider error code and never a free-form secret", () => {
    expect(sanitizeProviderErrorCode({ error: { code: "bad_request" } })).toBe(
      "bad_request",
    );
    expect(sanitizeProviderErrorCode({ errors: [{ code: 1001 }] })).toBe("1001");
    expect(sanitizeProviderErrorCode({
      error: { code: "token secret-value-must-not-reach-evidence" },
    })).toBeNull();
    expect(sanitizeProviderErrorCode({ error: { message: "invalid nodeVersion" } })).toBeNull();
  });
});
