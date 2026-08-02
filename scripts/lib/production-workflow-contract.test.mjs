import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const readiness = read(".github/workflows/production-readiness.yml");
const disasterRecovery = read(".github/workflows/production-dr-operations.yml");
const ephemeralPreview = read(".github/workflows/ephemeral-preview.yml");
const statusPage = read(".github/workflows/status-page-deploy.yml");
const drSmoke = read("scripts/run-dr-readonly-smoke.mjs");
const vercel = JSON.parse(read("vercel.json"));

describe("Production workflow approval contract", () => {
  it("keeps main Git pushes in Plan mode and gates Apply with a matching receipt", () => {
    expect(readiness).toContain("name: Create immutable Production plan receipt");
    expect(readiness).toContain("name: Verify manual approval is bound to the immutable plan");
    expect(readiness).toContain("description: Type APPLY_PRODUCTION_RELEASE when applying");
    expect(readiness).toMatch(
      /name: Apply pending migrations\r?\n\s+if: inputs\.apply_migrations/u,
    );
    expect(readiness).toMatch(
      /name: Promote approved deployment and smoke Production\r?\n\s+if: inputs\.apply_migrations/u,
    );
  });

  it("requires a prior Plan receipt for every DR and status-page Apply", () => {
    for (const operation of ["plan-bootstrap", "plan-drill", "plan-storage-canary"]) {
      expect(disasterRecovery).toContain(`- ${operation}`);
    }
    expect(disasterRecovery.match(/needs: approval/gu)).toHaveLength(3);
    expect(disasterRecovery).toContain("production-approval.mjs verify");
    expect(statusPage).toContain("plan_run_id:");
    expect(statusPage.indexOf("production-approval.mjs verify")).toBeLessThan(
      statusPage.indexOf("name: Deploy Worker and custom domain"),
    );
  });

  it("fails closed when a DR or restored-Primary smoke command fails", () => {
    expect(drSmoke).toContain("where state = 'ACTIVE'");
    expect(drSmoke).not.toContain("where status = 'ACTIVE'");
    expect(disasterRecovery).toMatch(
      /name: Run read-only DR smoke[\s\S]*?run: \|\r?\n\s+set -euo pipefail\r?\n\s+node scripts\/run-dr-readonly-smoke\.mjs \| tee/u,
    );
    expect(disasterRecovery).toMatch(
      /name: Validate restored Primary[\s\S]*?run: \|\r?\n\s+set -euo pipefail\r?\n\s+node scripts\/validate-active-backend\.mjs/u,
    );
  });

  it("disables Vercel Git auto-deploy only for main", () => {
    expect(vercel.git.deploymentEnabled).toEqual({ main: false });
  });

  it("makes Preview Function deployment bounded and idempotent", () => {
    expect(ephemeralPreview).toContain(
      "for function_directory in supabase/functions/*; do",
    );
    expect(ephemeralPreview).toContain("deployment already exists");
    expect(ephemeralPreview).toContain("unexpected deploy status (429|500|502|503|504)");
    expect(ephemeralPreview).toContain("for attempt in 1 2 3; do");
  });
});

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}
