import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentPartialSecurityQuery, readCurrentPartialSecurity } from "./staging-partial-retirement-security.mjs";

const query = vi.hoisted(() => vi.fn());
vi.mock("./dr-staging-conversion-plan.mjs", () => ({ conversionQuery: query }));
function snapshot() {
  return { version: 1, serverMajor: 17, database: { owner: "postgres", acl: null, encoding: 6,
    collate: "C.UTF-8", ctype: "C.UTF-8", localeProvider: "c", locale: null, collationVersion: null },
    roles: [{ name: "postgres", superuser: false, inherit: true, createRole: true, createDatabase: true,
      login: true, replication: true, bypassRls: true, connectionLimit: -1, validUntil: null, settings: [] }],
    memberships: [], roleSettings: [], extensions: [], eventTriggers: [], securityLabels: [],
    sharedSecurityLabels: [], globalDefaultAcls: [] };
}

describe("current global security facts are not original-backup or continuation proof", () => {
  beforeEach(() => { query.mockReset(); });

  it("reads only the fixed retired target, retains private security facts and refuses all safety/history/Plan claims", async () => {
    const value = snapshot();
    value.roles[0].settings = ["application_name=private sentinel"];
    query.mockResolvedValue([{ current_global_security: value }]);
    const { privateGlobalSecurity, ...summary } = await readCurrentPartialSecurity();
    expect(privateGlobalSecurity).toEqual(value);
    expect(summary).toEqual({ diagnosticOnly: true, planQualified: false,
      currentGlobalSecurityCaptured: true, historicalGlobalStateProven: false,
      currentGlobalSafetyProven: false, roleCount: 1, membershipCount: 0, extensionCount: 0,
      eventTriggerCount: 0, securityLabelCount: 0 });
    expect(JSON.stringify(summary)).not.toContain("private sentinel");
    expect(query).toHaveBeenCalledExactlyOnceWith(currentPartialSecurityQuery(), true);
  });

  it("distinguishes settings for all roles from a real role named all-roles", async () => {
    const value = snapshot();
    value.roles.push({ ...value.roles[0], name: "all-roles" });
    value.roleSettings = [
      { scope: "current-database", role: null, settings: ["statement_timeout=1s"] },
      { scope: "current-database", role: "all-roles", settings: ["statement_timeout=2s"] },
    ];
    query.mockResolvedValue([{ current_global_security: value }]);
    expect((await readCurrentPartialSecurity()).privateGlobalSecurity.roleSettings).toEqual(value.roleSettings);
    expect(currentPartialSecurityQuery()).toContain("when s.setrole=0 then null");
  });

  it("keeps extension, event-trigger and security-label content private without calling application functions", async () => {
    const value = snapshot();
    value.extensions = [{ name: "fixture", owner: "postgres", schema: "public", version: "1",
      relocatable: false, tables: ["public.config"], conditions: ["private condition"] }];
    value.eventTriggers = [{ name: "fixture", owner: "postgres", event: "ddl_command_end", enabled: "D",
      tags: ["CREATE TABLE"], function: "public.fixture()", definition: "private function body" }];
    value.securityLabels = [{ type: "table", object: "public.config", provider: "fixture", label: "private label" }];
    value.sharedSecurityLabels = [{ type: "role", object: "postgres", provider: "fixture", label: "private shared label" }];
    value.globalDefaultAcls = [{ owner: "postgres", type: "r", acl: ["postgres=r/postgres"] }];
    query.mockResolvedValue([{ current_global_security: value }]);
    const { privateGlobalSecurity, ...summary } = await readCurrentPartialSecurity();
    expect(privateGlobalSecurity).toEqual(value);
    expect(summary).toMatchObject({ extensionCount: 1, eventTriggerCount: 1, securityLabelCount: 2 });
    expect(JSON.stringify(summary)).not.toMatch(/private|public\.config|postgres|fixture/);
  });

  it("rejects incomplete, overbroad, inconsistent and secret-bearing response shapes with fixed errors", async () => {
    const mutations = [
      v => { v.serverMajor = 16; }, v => { delete v.database; }, v => { v.roles[0].password = "private secret"; },
      v => { v.roles.push(v.roles[0]); }, v => { v.roles[0].superuser = "true"; },
      v => { v.memberships = [{ role: "unknown", member: "postgres", grantor: "postgres", admin: true, inherit: true, set: true }]; },
      v => { v.roleSettings = [{ role: "unknown", scope: "current-database", settings: [] }]; },
      v => { v.extensions = [{ name: "fixture", owner: "postgres", schema: "public", version: "1", relocatable: true,
        tables: ["public.config"], conditions: [] }]; },
      v => { v.securityLabels = [{ type: "table", object: "public.config", provider: "fixture", label: null }]; },
      v => { v.roles[0].settings = [null]; },
    ];
    for (const mutate of mutations) {
      const value = snapshot(); mutate(value);
      query.mockResolvedValue([{ current_global_security: value }]);
      await expect(readCurrentPartialSecurity()).rejects.toThrow(/^STAGING_PARTIAL_SECURITY_INVALID$/);
    }
    for (const response of [[], [{}], [{ current_global_security: snapshot(), extra: "private secret" }],
      [{ current_global_security: snapshot() }, { current_global_security: snapshot() }]]) {
      query.mockResolvedValue(response);
      await expect(readCurrentPartialSecurity()).rejects.toThrow(/^STAGING_PARTIAL_SECURITY_INVALID$/);
    }
    query.mockRejectedValue(new Error("private transport credential"));
    await expect(readCurrentPartialSecurity()).rejects.toThrow(/^STAGING_PARTIAL_SECURITY_READ_FAILED$/);
  });

  it("uses one qualified catalog SELECT without password verifiers, writes or user-supplied SQL", () => {
    const sql = currentPartialSecurityQuery();
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).toMatch(/^select pg_catalog\.jsonb_build_object/);
    expect(sql).not.toMatch(/\b(?:insert|update|delete|alter|create|drop|set_config|rolpassword|pg_authid)\b/i);
    expect(sql).not.toMatch(/(?<!pg_catalog\.)\b(?:jsonb_build_object|jsonb_agg|pg_get_userbyid|pg_get_functiondef|pg_identify_object|unnest|current_setting|current_database)\(/);
    for (const catalog of ["pg_database", "pg_roles", "pg_auth_members", "pg_db_role_setting", "pg_extension",
      "pg_event_trigger", "pg_seclabel", "pg_shseclabel", "pg_default_acl"]) expect(sql).toContain(`pg_catalog.${catalog}`);
  });
});
