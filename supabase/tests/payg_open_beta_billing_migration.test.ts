import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260821150000_payg_open_beta_billing.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("PAYG open-beta billing migration", () => {
  it("backfills each historical invoice from its own BASE_PLAN contract", () => {
    const start = migrationSource.indexOf("with historical_invoice_contracts as (");
    const end = migrationSource.indexOf("alter table public.invoices\n  add constraint");
    const backfill = migrationSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(backfill).toContain("from public.invoice_line_items line_item");
    expect(backfill).toContain("line_item.item_type = 'BASE_PLAN'");
    expect(backfill).toContain("version.id::text = line_item.reference_id");
    expect(backfill).toContain("order by line_item.invoice_id, line_item.created_at desc, line_item.id desc");
    expect(backfill).not.toContain("public.subscriptions");
    expect(backfill).toContain("PAYG_INVOICE_PRICING_BACKFILL_MISMATCH");
  });
});
