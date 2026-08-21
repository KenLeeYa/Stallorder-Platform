import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../migrations/20260813070000_phase_three_feature_flag_hard_lock.sql",
  import.meta.url,
));
const migrationSource = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n")
  : "";

const phaseThreeCodes = [
  "DIGITAL_WAITLIST_FOUNDATION_ENABLED",
  "ONLINE_ORDER_PAYMENT_ENABLED",
  "RESERVATION_PREORDER_ENABLED",
  "DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED",
  "CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED",
] as const;

describe("Phase 3 feature flag database hard lock migration", () => {
  it("ships as a new append-only migration covering exactly the five dormant flags", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const code of phaseThreeCodes) {
      expect(migrationSource).toContain(`'${code}'`);
    }
    expect(migrationSource).not.toMatch(/delete\s+from\s+public\.resilience_feature_flag/iu);
  });

  it("installs both write guards before cleaning existing enabled rows", () => {
    const overrideCleanup = migrationSource.search(
      /update\s+public\.resilience_feature_flag_overrides[\s\S]*?set\s+enabled\s*=\s*false/iu,
    );
    const defaultCleanup = migrationSource.search(
      /update\s+public\.resilience_feature_flags[\s\S]*?set\s+default_enabled\s*=\s*false/iu,
    );
    const catalogTrigger = migrationSource.search(/create\s+trigger\s+resilience_feature_flags_phase_three_lock_guard/iu);
    const overrideTrigger = migrationSource.search(/create\s+trigger\s+resilience_feature_flag_overrides_phase_three_lock_guard/iu);

    expect(catalogTrigger).toBeGreaterThanOrEqual(0);
    expect(overrideTrigger).toBeGreaterThan(catalogTrigger);
    expect(overrideCleanup).toBeGreaterThan(overrideTrigger);
    expect(defaultCleanup).toBeGreaterThan(overrideCleanup);
  });

  it("uses a single-lock-order database trigger for catalog and override writes", () => {
    expect(migrationSource).toContain(
      "create function app_private.enforce_phase_three_feature_flag_lock()",
    );
    expect(migrationSource).toContain("RESILIENCE_PHASE_THREE_FLAG_LOCKED");
    expect(migrationSource).toContain("new.default_enabled");
    expect(migrationSource).toContain("new.enabled");
    expect(migrationSource).toContain("old.code is distinct from new.code");
    expect(migrationSource).not.toMatch(/\bfor\s+update\b/iu);
    expect(migrationSource).not.toMatch(
      /from\s+public\.resilience_feature_flag_overrides\s+flag_override[\s\S]*?for\s+update/iu,
    );
    expect(migrationSource).toMatch(
      /create\s+trigger\s+resilience_feature_flags_phase_three_lock_guard[\s\S]*before\s+insert\s+or\s+update\s+of\s+code,\s*default_enabled[\s\S]*on\s+public\.resilience_feature_flags/iu,
    );
    expect(migrationSource).toMatch(
      /create\s+trigger\s+resilience_feature_flag_overrides_phase_three_lock_guard[\s\S]*before\s+insert\s+or\s+update\s+of\s+flag_id,\s*enabled[\s\S]*on\s+public\.resilience_feature_flag_overrides/iu,
    );
  });

  it("keeps a row-local CHECK guard and private trigger privileges", () => {
    expect(migrationSource).toContain(
      "constraint resilience_feature_flags_phase_three_default_off_check",
    );
    expect(migrationSource).toMatch(
      /revoke\s+all\s+on\s+function\s+app_private\.enforce_phase_three_feature_flag_lock\(\)[\s\S]*from\s+public,\s*anon,\s*authenticated,\s*service_role/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant\s+execute\s+on\s+function\s+app_private\.enforce_phase_three_feature_flag_lock/iu,
    );
  });
});
