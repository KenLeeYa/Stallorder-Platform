import { describe, expect, it } from "vitest";
import {
  buildRepairPlan,
  einvoiceFeatureFlags,
  verifyRepair,
} from "./dr-billing-feature-flag-conflict.mjs";

function rows(timestamp, overrides = {}) {
  return einvoiceFeatureFlags.map((flag) => ({
    code: flag.code,
    is_enabled: flag.isEnabled,
    phase: flag.phase,
    description: flag.description,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides[flag.code],
  }));
}

describe("DR billing feature flag conflict repair", () => {
  it("plans deletion only when Primary and DR business rows match but timestamps differ", () => {
    const plan = buildRepairPlan({
      primaryRows: rows("2026-08-30T17:47:33.880Z"),
      drRows: rows("2026-08-30T17:29:18.747Z"),
    });

    expect(plan).toMatchObject({
      table: "public.billing_feature_flags",
      constraint: "billing_feature_flags_pkey",
      conflictCode: "23505",
      rowCount: 13,
      businessRowsEquivalent: true,
    });
    expect(plan.primaryBusinessDigest).toBe(plan.drBusinessDigest);
    expect(plan.primaryRowDigest).not.toBe(plan.drRowDigest);
  });

  it("fails closed for a missing or changed DR row", () => {
    expect(() => buildRepairPlan({
      primaryRows: rows("2026-08-30T17:47:33.880Z"),
      drRows: rows("2026-08-30T17:29:18.747Z").slice(1),
    })).toThrow("DR_FEATURE_FLAG_COUNT_MISMATCH");

    expect(() => buildRepairPlan({
      primaryRows: rows("2026-08-30T17:47:33.880Z"),
      drRows: rows("2026-08-30T17:29:18.747Z", {
        EINVOICE_PLATFORM_ENABLED: { is_enabled: true },
      }),
    })).toThrow("DR_FEATURE_FLAG_STATE_MISMATCH");
  });

  it("refuses repair once rows are already synchronized", () => {
    const synchronized = rows("2026-08-30T17:47:33.880Z");
    expect(() => buildRepairPlan({
      primaryRows: synchronized,
      drRows: synchronized,
    })).toThrow("FEATURE_FLAG_ROWS_ALREADY_SYNCHRONIZED");
  });

  it("verifies exact replicated rows after catch-up", () => {
    const synchronized = rows("2026-08-30T17:47:33.880Z");
    expect(verifyRepair({
      primaryRows: synchronized,
      drRows: synchronized,
    })).toMatchObject({ rowCount: 13, rowsIdentical: true });

    expect(() => verifyRepair({
      primaryRows: synchronized,
      drRows: rows("2026-08-30T17:29:18.747Z"),
    })).toThrow("FEATURE_FLAG_REPAIR_NOT_REPLICATED");
  });
});
