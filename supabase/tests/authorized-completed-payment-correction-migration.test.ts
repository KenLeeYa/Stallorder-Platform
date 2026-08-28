import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260828110000_authorized_completed_payment_correction.sql",
  import.meta.url,
)), "utf8").replace(/\r\n/g, "\n");

describe("authorized completed-payment correction migration", () => {
  it("keeps direct payment and cash-shift rewrites immutable", () => {
    expect(migrationSource).toContain("PAYMENT_CASH_SHIFT_IMMUTABLE");
    expect(migrationSource).toContain("current_setting('app.payment_method_correction', true)");
    expect(migrationSource).toContain("new.payment_option_id is distinct from old.payment_option_id");
    expect(migrationSource).toContain("new.reconciliation_status is not distinct from old.reconciliation_status");
    expect(migrationSource).toContain("new.offline_payment_method is not distinct from old.offline_payment_method");
    expect(migrationSource).toContain("new.amount is distinct from old.amount");
  });

  it("still requires an open, tenant-matched shift for a corrected cash payment", () => {
    expect(migrationSource).toContain("v_shift.organization_id <> new.organization_id");
    expect(migrationSource).toContain("v_shift.stall_id <> new.stall_id");
    expect(migrationSource).toContain("v_shift.status <> 'OPEN'::public.cash_shift_status");
    expect(migrationSource).toContain("ACTIVE_CASH_SHIFT_REQUIRED");
  });

  it("does not grant the correction path to browser roles", () => {
    expect(migrationSource).not.toMatch(/grant\s+(?:update|execute)[\s\S]*?to\s+(?:anon|authenticated)/i);
  });
});
