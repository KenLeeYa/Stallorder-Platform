import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260826160000_event_growth_foundation.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

const tables = [
  "event_growth_campaigns",
  "event_growth_touchpoints",
  "event_growth_order_attributions",
  "event_growth_expenses",
  "event_growth_metric_snapshots",
] as const;

describe("event growth foundation migration", () => {
  it("is additive and reuses the existing MarketEvent aggregate", () => {
    expect(assertAdditiveMigrationSql(migrationSource)).toBe(true);
    for (const table of tables) expect(migrationSource).toContain(`create table public.${table}`);
    expect(migrationSource).toContain("references public.market_events(id)");
  });

  it("keeps attribution server-authoritative and pseudonymous", () => {
    expect(migrationSource).not.toMatch(/grant\s+select[\s\S]*?to\s+authenticated/i);
    expect(migrationSource.match(/force row level security/g)).toHaveLength(tables.length);
    expect(migrationSource.match(/create trigger backend_writable_guard/g)).toHaveLength(tables.length);
    expect(migrationSource.match(/to service_role;/g)).toHaveLength(tables.length);
    expect(migrationSource).toContain("visitor_hash text not null");
    expect(migrationSource).not.toMatch(/visitor_(?:email|phone|name)/i);
  });

  it("records evidence and estimates without automatic payout fields", () => {
    expect(migrationSource).toContain("attribution_model");
    expect(migrationSource).toContain("estimated_revenue_amount");
    expect(migrationSource).toContain("expense_amount");
    expect(migrationSource).not.toMatch(/payout|settlement/i);
  });
});
