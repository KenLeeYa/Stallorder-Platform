import { describe, expect, it } from "vitest";
import { retiredDrSequenceCleanupSql, disableStagingCronsSql, syntheticStagingSafetySql } from "./dr-reset-preparation.mjs";

describe("retired DR reset preparation", () => {
  it("restricts the seed overlay to known synthetic tenants and disables hardware and payment providers", () => {
    expect(syntheticStagingSafetySql).toContain("STAGING_SEED_SCOPE_INVALID");
    expect(syntheticStagingSafetySql).toContain("DEMO_BESTSELLER_SEED");
    expect(syntheticStagingSafetySql).toContain("update public.orders set is_test = true");
    expect(syntheticStagingSafetySql).toContain("update public.printers set is_enabled = false");
    expect(syntheticStagingSafetySql).toContain("where kind <> 'CASH'");
  });
  it("uses the permitted owner API instead of updating provider-owned cron tables", () => {
    expect(disableStagingCronsSql).toContain("cron.alter_job(jobid, active := false)");
    expect(disableStagingCronsSql).not.toMatch(/update\s+cron\.job/i);
  });
  it("targets only ordinary public sequences, including unowned invoice counters", () => {
    expect(retiredDrSequenceCleanupSql).toContain("c.relkind = 'S'");
    expect(retiredDrSequenceCleanupSql).toContain("n.nspname = 'public'");
    expect(retiredDrSequenceCleanupSql).toContain("d.deptype in ('e', 'a', 'i')");
    expect(retiredDrSequenceCleanupSql).toContain("format('drop sequence %I.%I cascade'");
    expect(retiredDrSequenceCleanupSql).not.toMatch(/drop schema|drop database|alter role/i);
  });
});
