import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260820071255_restore_report_delivery_scheduler_contract.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("report delivery scheduler contract migration", () => {
  it("passes the additive-only DR migration guard", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
  });

  it("restores the hardened function and fixed cron contract atomically", () => {
    expect(migrationSource.trimStart()).toMatch(/^begin;/u);
    expect(migrationSource.trimEnd()).toMatch(/commit;$/u);
    expect(migrationSource).toContain(
      "create or replace function app_private.invoke_due_report_deliveries()",
    );
    expect(migrationSource).toContain("security definer");
    expect(migrationSource).toContain("set search_path = ''");
    expect(migrationSource).toContain(
      "revoke all on function app_private.invoke_due_report_deliveries()",
    );
    expect(migrationSource).toContain("where jobname = 'stallorder-report-deliveries'");
    expect(migrationSource).toContain("'*/5 * * * *'");
    expect(migrationSource).toContain(
      "'select app_private.invoke_due_report_deliveries()'",
    );
  });

  it("does not embed report delivery credentials in the cron command", () => {
    const schedulerBlock = migrationSource.slice(
      migrationSource.indexOf("do $scheduler$"),
    );
    expect(schedulerBlock).not.toMatch(/Bearer|cron_secret|bypass_secret/u);
  });
});
