import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260813090000_enable_pro_printer_entitlement.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("Pro printer entitlement migration", () => {
  it("targets every existing Pro and Enterprise plan version", () => {
    expect(migrationSource).toContain("plan.code in ('PRO', 'ENTERPRISE')");
    expect(migrationSource).not.toMatch(/\bplan\.is_active\b/);
    expect(migrationSource).not.toMatch(/\bversion\.effective_(?:from|until)\b/);
  });

  it("is idempotent, preserves limits, and merges the opt-in configuration", () => {
    const conflictUpdate = migrationSource.match(
      /on conflict \(plan_version_id, feature_code\) do update\s+set([\s\S]*?);/i,
    )?.[1];

    expect(migrationSource).toContain("'PRINTER_INTEGRATION'");
    expect(migrationSource).toContain("jsonb_build_object('merchantModuleOptIn', true)");
    expect(migrationSource).toContain("on conflict (plan_version_id, feature_code) do update");
    expect(conflictUpdate).toContain("is_enabled = true");
    expect(conflictUpdate).toContain("coalesce(entitlement.configuration_json, '{}'::jsonb)");
    expect(conflictUpdate).toContain("|| excluded.configuration_json");
    expect(conflictUpdate).not.toMatch(/\blimit_value\s*=/i);
  });

  it("does not automatically enable a stall print module", () => {
    expect(migrationSource).not.toMatch(/\bupdate\s+public\.stall_ordering_settings\b/i);
    expect(migrationSource).not.toMatch(/\binsert\s+into\s+public\.stall_ordering_settings\b/i);
  });
});
