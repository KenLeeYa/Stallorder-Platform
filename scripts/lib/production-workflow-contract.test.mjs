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

  it("makes Preview Function deployment bounded and fail closed", () => {
    expect(ephemeralPreview).toContain(
      "for function_directory in supabase/functions/*; do",
    );
    expect(ephemeralPreview).not.toContain("deployment already exists");
    expect(ephemeralPreview).toContain("unexpected deploy status (429|500|502|503|504)");
    expect(ephemeralPreview).toContain("for attempt in 1 2 3; do");
  });

  it("gates the matching Preview with read-only smoke before synthetic writes", () => {
    const deployPreview = ephemeralPreview.indexOf("name: Deploy matching Vercel Preview");
    const readOnlySmoke = ephemeralPreview.indexOf(
      "name: Run matching Preview read-only smoke",
    );
    const syntheticSmoke = ephemeralPreview.indexOf(
      "name: Run synthetic OAuth and delivery smoke tests",
    );

    expect(deployPreview).toBeGreaterThan(-1);
    expect(deployPreview).toBeLessThan(readOnlySmoke);
    expect(readOnlySmoke).toBeLessThan(syntheticSmoke);
    expect(ephemeralPreview).toContain(
      "PRODUCTION_BASE_URL: ${{ steps.vercel-preview.outputs.url }}",
    );
    expect(ephemeralPreview).toContain('SMOKE_SKIP_DOMAIN_REDIRECTS: "true"');
    expect(ephemeralPreview).toContain('PRODUCTION_TEST_QR_REQUIRED: "false"');
    expect(ephemeralPreview).toContain("run: npm run production:smoke");
  });

  it("deletes every metadata-matched Preview URL and verifies cleanup", () => {
    const cleanupStart = ephemeralPreview.indexOf(
      "name: Remove closed Pull Request Vercel Previews",
    );
    const cleanupEnd = ephemeralPreview.indexOf(
      "name: Remove closed Pull Request Preview Branch",
    );
    const cleanup = ephemeralPreview.slice(cleanupStart, cleanupEnd);

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(cleanup).toContain(".deployments[]?.url // empty");
    expect(cleanup).toContain('vercel@58.3.0 remove "$deployment_url"');
    expect(cleanup).toContain(".deployments | length == 0");
    expect(cleanup).toContain("--limit 100");
    expect(cleanup).not.toContain("|| true");
  });

  it("deploys and verifies every Production Function only during Apply", () => {
    expect(readiness).toMatch(
      /name: Deploy Production Edge Functions\r?\n\s+if: inputs\.apply_migrations/u,
    );
    expect(readiness).toMatch(
      /name: Verify deployed Production Edge Functions\r?\n\s+if: inputs\.apply_migrations/u,
    );
    expect(readiness).toContain("for function_directory in supabase/functions/*; do");
    expect(readiness).toContain("for attempt in 1 2 3; do");
    expect(readiness).not.toContain("deployment already exists");
    expect(readiness).toContain("--use-api");
    expect(readiness).toContain("--import-map supabase/functions/deno.json");
    expect(readiness).toContain("supabase functions list");
    expect(readiness).toContain(
      '(.slug // .name) == $function_name and .status == "ACTIVE"',
    );
    expect(readiness).toContain("missing or not ACTIVE after deployment");
    expect(readiness).not.toContain("--prune");

    const postApplyLint = readiness.indexOf("name: Lint remote database after apply");
    const deployFunctions = readiness.indexOf("name: Deploy Production Edge Functions");
    const verifyFunctions = readiness.indexOf("name: Verify deployed Production Edge Functions");
    const promote = readiness.indexOf("name: Promote approved deployment and smoke Production");
    expect(postApplyLint).toBeGreaterThan(-1);
    expect(postApplyLint).toBeLessThan(deployFunctions);
    expect(deployFunctions).toBeLessThan(verifyFunctions);
    expect(verifyFunctions).toBeLessThan(promote);
  });

  it("requires the protected Production QR before running Apply smoke", () => {
    expect(readiness).toContain(
      "PRODUCTION_TEST_QR_URL: ${{ secrets.PRODUCTION_TEST_QR_URL }}",
    );
    expect(readiness).toContain("PRODUCTION_TEST_QR_REQUIRED: \"true\"");
    expect(readiness).toContain(
      "for name in PRODUCTION_TEST_QR_URL VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do",
    );
    expect(readiness).toContain("resolveProductionTestQrUrl({");
  });
});

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}
