import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260820070000_global_stall_code_guard_rollout_safety.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("global stall code rollout safety migration", () => {
  it("passes the additive-only DR migration guard", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });

  it("locks writes before replacing the guard and audits before commit", () => {
    const beginPosition = migrationSource.indexOf("begin;");
    const lockPosition = migrationSource.indexOf(
      "lock table public.stalls in share row exclusive mode;",
    );
    const indexPosition = migrationSource.indexOf(
      "create index if not exists stalls_code_lower_lookup_idx",
    );
    const triggerPosition = migrationSource.indexOf(
      "create trigger stalls_validate_global_code_before_write",
    );
    const auditPosition = migrationSource.indexOf("do $migration$");
    const commitPosition = migrationSource.lastIndexOf("commit;");

    expect(migrationSource).toContain("set local lock_timeout = '5s';");
    expect(migrationSource).toContain("set local statement_timeout = '2min';");
    expect(beginPosition).toBeGreaterThan(-1);
    expect(lockPosition).toBeGreaterThan(-1);
    expect(lockPosition).toBeGreaterThan(beginPosition);
    expect(indexPosition).toBeGreaterThan(lockPosition);
    expect(triggerPosition).toBeGreaterThan(indexPosition);
    expect(auditPosition).toBeGreaterThan(triggerPosition);
    expect(commitPosition).toBeGreaterThan(auditPosition);
    expect(migrationSource).toContain("group by pg_catalog.lower(stall.code)");
    expect(migrationSource).toContain("having pg_catalog.count(*) > 1");
    expect(migrationSource).toContain("message = 'GLOBAL_STALL_CODE_COLLISION'");
  });

  it("does not rewrite stall identifiers or rows", () => {
    expect(migrationSource).not.toMatch(/\bupdate\s+public\.stalls\b/i);
    expect(migrationSource).not.toMatch(/\bdelete\s+from\s+public\.stalls\b/i);
    expect(migrationSource).not.toMatch(/\bslug\b/i);
  });
});
