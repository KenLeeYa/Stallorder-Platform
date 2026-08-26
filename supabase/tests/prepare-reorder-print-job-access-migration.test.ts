import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826180000_prepare_reorder_print_job_access.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("prepare-reorder print-job access migration", () => {
  it("remains additive and exposes only a server-side boolean guard", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    expect(migrationSource).toContain(
      "create function public.reorder_print_job_started(p_order_id uuid)",
    );
    expect(migrationSource).toContain("security definer\nset search_path = ''");
    expect(migrationSource).toContain(
      "grant execute on function public.reorder_print_job_started(uuid)\nto service_role;",
    );
    expect(migrationSource).not.toMatch(/grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?public\.print_jobs/i);
    expect(migrationSource).not.toMatch(/grant\s+execute[\s\S]*?to\s+(?:anon|authenticated)/i);
  });
});
