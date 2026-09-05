import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260905130000_flexible_lottery_festival_campaigns.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("flexible lottery festival campaign migration", () => {
  it("stores tenant-scoped named periods with bounded independent product pools", () => {
    expect(migrationSource).toContain("create table public.stall_lottery_campaigns");
    expect(migrationSource).toContain("foreign key (stall_id, organization_id)");
    expect(migrationSource).toContain("check (cardinality(product_ids) <= 100");
    expect(migrationSource).toContain("lower(btrim(name))");
    expect(migrationSource).not.toContain("insert into public.stall_lottery_campaigns");
  });

  it("serializes writes and rejects overlapping enabled schedules", () => {
    expect(migrationSource).toContain("pg_advisory_xact_lock");
    expect(migrationSource).toContain("LOTTERY_CAMPAIGN_DATES_OVERLAP");
    expect(migrationSource).toContain("daterange(campaign.starts_on, campaign.ends_on, '[]')");
  });

  it("keeps product selection and redemption server-authoritative", () => {
    expect(migrationSource).toContain("app_private.get_festival_lottery_product_pool");
    expect(migrationSource).toContain("assignment.product_id = any(campaign.product_ids)");
    expect(migrationSource).toContain("draw.selected_product_id = new.product_id");
    expect(migrationSource).toContain("campaign_id = v_campaign.id");
    expect(migrationSource).toContain("campaign_id is null\n      or length(btrim(campaign_name)) between 1 and 80");
  });

  it("does not expose direct table or helper access to public roles", () => {
    expect(migrationSource).toContain("force row level security");
    expect(migrationSource).toContain(
      "revoke all on table public.stall_lottery_campaigns from public, anon, authenticated",
    );
    expect(migrationSource).toContain(
      "revoke all on function app_private.get_festival_lottery_product_pool(uuid, uuid, uuid)",
    );
  });
});
