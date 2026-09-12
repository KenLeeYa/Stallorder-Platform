import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "./additive-migration-plan.mjs";

const files = [
  "20260912112000_product_availability_deadlines.sql",
  "20260912112100_order_amendment_print_jobs.sql",
  "20260912112200_staff_push_menu_announcements.sql",
];
const read = (file) => readFileSync(resolve(import.meta.dirname, "../../supabase/migrations", file), "utf8");

describe("reviewed availability, amendment and push release migrations", () => {
  it.each(files)("accepts the reviewed schema transition: %s", (file) => {
    expect(assertAdditiveMigrationSql(read(file))).toBe(true);
  });

  it.each(files)("rejects changes appended to a reviewed transition: %s", (file) => {
    const sql = read(file);
    for (const change of [
      "delete from public.orders;",
      "update public.stall_products set is_enabled = true;",
      "alter table public.orders disable row level security;",
      "grant all on table public.orders to anon;",
      "drop table public.orders;",
    ]) {
      expect(() => assertAdditiveMigrationSql(sql + "\n" + change)).toThrow();
    }
  });

  it("rejects removal of the original-ticket deduplication condition", () => {
    expect(() => assertAdditiveMigrationSql(read(files[1]).replaceAll("and amendment_id is null", ""))).toThrow();
  });

  it("rejects pushing to unprivileged subscriptions or bypassing RLS", () => {
    expect(() => assertAdditiveMigrationSql(read(files[2]).replace("to service_role;", "to anon;"))).toThrow();
    expect(() => assertAdditiveMigrationSql(read(files[2]).replaceAll("enable row level security", "disable row level security"))).toThrow();
  });

  it("keeps existing-row backfill out of DR schema and fences the Primary step", () => {
    const backfill = readFileSync(resolve(import.meta.dirname, "../sql/backfill-product-availability-deadlines.sql"), "utf8");
    expect(read(files[0])).not.toMatch(/update\s+public\.stall_products/iu);
    expect(backfill).toContain("runtime_state.backend_code <> 'PRIMARY'");
    expect(backfill).toContain("runtime_state.backend_role <> 'ACTIVE_WRITER'");
    expect(backfill).toContain("not runtime_state.writes_enabled");
    expect(backfill).toContain("where is_current for share");
    expect(backfill).toContain("where is_sold_out and sold_out_until is null");
    expect(backfill).not.toMatch(/set\s+(?:stock_remaining|is_enabled|is_sold_out)\s*=/iu);
    const production = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/production-readiness.yml"), "utf8");
    const dr = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/production-dr-operations.yml"), "utf8");
    expect(production.indexOf("backfill-product-availability-deadlines.sql")).toBeGreaterThan(production.indexOf("Apply pending migrations"));
    expect(dr).not.toContain("backfill-product-availability-deadlines.sql");
    const backfillStep = production.split("- name: Backfill legacy availability deadlines on the verified Primary writer")[1].split("- name:")[0];
    expect(backfillStep).toContain('psql --dbname "$SUPABASE_CI_DATABASE_URL"');
    expect(backfillStep).toContain("--no-psqlrc --set ON_ERROR_STOP=1");
    expect(backfillStep).not.toContain("supabase db query");
    expect(production).toContain("run: psql --version");
  });

  it("fences new operational tables and excludes replayed offline orders", () => {
    const sql = read(files[2]);
    for (const table of ["stall_menu_announcements", "staff_push_subscriptions", "staff_push_deliveries"]) {
      expect(sql).toContain("before insert or update or delete on public." + table);
    }
    expect(sql).toContain("new.origin = 'OFFLINE_POS'::public.order_origin");
    expect(sql).toContain("after insert on public.orders");
  });
});
