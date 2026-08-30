import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const readiness = read(".github/workflows/production-readiness.yml");
const applicationRelease = read(".github/workflows/production-application-release.yml");
const disasterRecovery = read(".github/workflows/production-dr-operations.yml");
const ephemeralPreview = read(".github/workflows/ephemeral-preview.yml");
const statusPage = read(".github/workflows/status-page-deploy.yml");
const drSmoke = read("scripts/run-dr-readonly-smoke.mjs");
const productionApproval = read("scripts/lib/production-approval.mjs");
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

  it("supports an immutable application-only release without database mutation", () => {
    const deploy = applicationRelease.indexOf(
      "name: Build application-only Production deployment without assigning domains",
    );
    const previewSmoke = applicationRelease.indexOf(
      "name: Smoke application deployment before promotion",
    );
    const promote = applicationRelease.indexOf(
      "name: Promote approved application deployment and smoke Production",
    );

    expect(productionApproval).toContain('"production-application"');
    expect(applicationRelease).toContain("APPLY_PRODUCTION_APPLICATION");
    expect(applicationRelease).toContain("production-approval.mjs verify");
    expect(applicationRelease).toContain("production-application-plan-${{ github.run_id }}");
    expect(deploy).toBeGreaterThan(-1);
    expect(deploy).toBeLessThan(previewSmoke);
    expect(previewSmoke).toBeLessThan(promote);
    expect(applicationRelease).not.toMatch(/supabase\s+db\s+(?:push|reset)/u);
    expect(applicationRelease).not.toContain("supabase functions deploy");
    expect(applicationRelease).not.toContain("production-primary-migration");
  });

  it("requires a prior Plan receipt for every DR and status-page Apply", () => {
    for (const operation of [
      "plan-bootstrap",
      "plan-drill",
      "plan-dr-schema",
      "plan-incremental-replication",
      "plan-replication-conflict-repair",
      "plan-storage-canary",
    ]) {
      expect(disasterRecovery).toContain(`- ${operation}`);
    }
    for (const jobName of [
      "bootstrap",
      "drill",
      "dr-schema",
      "incremental-replication",
      "replication-conflict-repair",
      "storage-canary",
    ]) {
      expect(workflowJob(disasterRecovery, jobName)).toMatch(/needs: approval/u);
    }
    expect(disasterRecovery).toContain("production-approval.mjs verify");
    expect(statusPage).toContain("plan_run_id:");
    expect(statusPage.indexOf("production-approval.mjs verify")).toBeLessThan(
      statusPage.indexOf("name: Deploy Worker and custom domain"),
    );
  });

  it("applies additive schema to DR before Primary and never resets DR", () => {
    const plan = workflowJob(disasterRecovery, "plan");
    const job = workflowJob(disasterRecovery, "dr-schema");
    const migrationList = job.indexOf('migration list --db-url "$DR_DIRECT_URL"');
    const dryRun = job.indexOf('db push --db-url "$DR_DIRECT_URL" --dry-run');
    const apply = job.indexOf('db push --db-url "$DR_DIRECT_URL"', dryRun + 1);
    const postLint = job.indexOf("Lint DR database after additive migration Apply");

    expect(productionApproval).toContain('"production-dr-schema"');
    expect(plan).toContain("plan-dr-schema)");
    expect(plan).toContain("node scripts/production-readiness.mjs");
    expect(plan).toContain("assert-additive-migration-plan.mjs");
    expect(plan).toContain("dr-schema-additive-plan.json");
    expect(plan).toContain('migration list --db-url "$DR_DIRECT_URL"');
    expect(plan).toContain('db push --db-url "$DR_DIRECT_URL" --dry-run');
    expect(plan).toContain('db lint --db-url "$DR_DIRECT_URL"');
    expect(plan).toContain("dr-schema-plan-digest.txt");
    expect(job).toContain("APPLY_PRODUCTION_DR_SCHEMA");
    expect(job).toContain("name: Reject unreviewed destructive migrations");
    expect(job).toContain("node scripts/production-readiness.mjs");
    expect(job).toContain("assert-additive-migration-plan.mjs");
    expect(job).toContain("dr-schema-additive-plan-before.json");
    expect(job).toContain("needs: approval");
    expect(migrationList).toBeGreaterThan(-1);
    expect(migrationList).toBeLessThan(dryRun);
    expect(dryRun).toBeLessThan(apply);
    expect(apply).toBeLessThan(postLint);
    expect(job).toContain("production-dr-schema-evidence.json");
    expect(job).not.toContain('"$DIRECT_URL"');
    expect(job).not.toContain("--include-all");
    expect(job).not.toContain("--include-seed");
    expect(job).not.toContain("db reset");
    expect(job).not.toContain("--rollback");
  });

  it("binds a non-destructive incremental replication upgrade to Plan and Apply", () => {
    expect(productionApproval).toContain(
      '"production-dr-incremental-replication"',
    );
    expect(disasterRecovery).toContain(
      "incremental-replication:UPGRADE_PRODUCTION_DR_REPLICATION",
    );
    const plan = workflowJob(disasterRecovery, "plan");
    const job = workflowJob(disasterRecovery, "incremental-replication");
    const predecessor = job.indexOf("Verify Production migration completed");
    const inspect = job.indexOf("--inspect --upgrade-only");
    const apply = job.indexOf("--apply --upgrade-only");
    const snapshot = job.indexOf("refresh-dr-replication-snapshot.mjs");
    const readinessCheck = job.indexOf("check-dr-readiness.mjs --target DR --apply");

    expect(plan).toContain("--inspect --upgrade-only");
    expect(plan).toContain('"strategy":"UPGRADE_ONLY"');
    expect(plan).not.toContain('"strategy":"CREATE_OR_UPGRADE"');
    expect(job).toContain("needs: approval");
    expect(job).toContain("primary_migration_run_id");
    expect(job).toContain("production-approval.mjs verify-evidence");
    expect(job).toContain("cmp --silent");
    expect(predecessor).toBeGreaterThan(-1);
    expect(predecessor).toBeLessThan(inspect);
    expect(inspect).toBeLessThan(apply);
    expect(apply).toBeGreaterThan(-1);
    expect(apply).toBeLessThan(snapshot);
    expect(snapshot).toBeLessThan(readinessCheck);
    expect(job).not.toContain("supabase db reset");
    expect(job).not.toContain("--rollback");
    expect(job).not.toContain("drop publication");
    expect(job).not.toContain("drop subscription");
  });

  it("binds the one-time replication conflict repair to exact Plan and readiness proof", () => {
    expect(productionApproval).toContain(
      '"production-dr-replication-conflict-repair"',
    );
    const plan = workflowJob(disasterRecovery, "plan");
    const job = workflowJob(disasterRecovery, "replication-conflict-repair");
    const inspect = job.indexOf("--inspect");
    const apply = job.indexOf("--apply");
    const snapshot = job.indexOf("refresh-dr-replication-snapshot.mjs");
    const verify = job.indexOf("--verify");
    const readinessCheck = job.indexOf("check-dr-readiness.mjs --target DR --apply");

    expect(plan).toContain("plan-replication-conflict-repair)");
    expect(plan).toContain("INSPECT_DR_BILLING_FEATURE_FLAG_CONFLICT");
    expect(plan).toContain("EINVOICE_FEATURE_FLAG_SEED_CONFLICT");
    expect(job).toContain("needs: approval");
    expect(job).toContain("REPAIR_PRODUCTION_DR_REPLICATION_CONFLICT");
    expect(job).toContain("cmp --silent");
    expect(inspect).toBeGreaterThan(-1);
    expect(inspect).toBeLessThan(apply);
    expect(apply).toBeLessThan(snapshot);
    expect(snapshot).toBeLessThan(verify);
    expect(verify).toBeLessThan(readinessCheck);
    expect(job).toContain("production-dr-replication-conflict-repair-evidence.json");
    expect(job).not.toContain("supabase db reset");
    expect(job).not.toContain("drop publication");
    expect(job).not.toContain("drop subscription");
  });

  it("requires successful DR schema evidence before Primary migration evidence", () => {
    const verifyDrSchema = readiness.indexOf(
      "name: Verify DR schema completed before the Production Plan or Apply",
    );
    const applyPrimary = readiness.indexOf("name: Apply pending migrations");
    const primaryEvidence = readiness.indexOf(
      "name: Create immutable successful Production migration evidence",
    );

    expect(readiness).toContain("dr_schema_run_id:");
    expect(readiness).toContain("production-dr-schema-apply-${{ inputs.dr_schema_run_id }}");
    expect(verifyDrSchema).toBeGreaterThan(-1);
    expect(verifyDrSchema).toBeLessThan(applyPrimary);
    expect(applyPrimary).toBeLessThan(primaryEvidence);
    expect(readiness).toContain("production-primary-migration-${{ github.run_id }}");
  });

  it("keeps dispatch inputs out of shell source and scopes database secrets after install", () => {
    const plan = workflowJob(disasterRecovery, "plan");
    const incremental = workflowJob(disasterRecovery, "incremental-replication");

    expect(readiness).not.toContain('test "${{ inputs.');
    expect(readiness).not.toContain("format('{\"");
    expect(plan).not.toContain('test "${{ inputs.');
    expect(plan.indexOf("npm ci")).toBeLessThan(
      plan.indexOf("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}"),
    );
    expect(incremental.indexOf("npm ci")).toBeLessThan(
      incremental.indexOf("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}"),
    );
    for (const jobName of ["bootstrap", "drill", "storage-canary"]) {
      const job = workflowJob(disasterRecovery, jobName);
      const jobDeclaration = job.slice(0, job.indexOf("    steps:"));
      expect(job).not.toContain('test "${{ inputs.');
      expect(jobDeclaration).not.toContain("${{ secrets.");
      expect(job).toContain("INPUT_CONFIRMATION: ${{ inputs.confirmation }}");
      expect(job).toContain('test "$INPUT_CONFIRMATION"');
    }
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

  it("proves mirrored Storage metadata before and after a bootstrap reset", () => {
    const bootstrap = workflowJob(disasterRecovery, "bootstrap");
    const preReset = bootstrap.indexOf("storage-mirror-pre-reset.json");
    const reset = bootstrap.indexOf(
      'supabase db reset --db-url "$DR_DIRECT_URL" --no-seed --yes',
    );
    const postReset = bootstrap.indexOf("storage-mirror-post-reset.json");

    expect(preReset).toBeGreaterThan(-1);
    expect(preReset).toBeLessThan(reset);
    expect(reset).toBeLessThan(postReset);
    expect(bootstrap).toContain("node scripts/verify-dr-storage-mirror.mjs");
    expect(bootstrap).toContain("storageMirrorVerified");
    expect(bootstrap).toContain("primaryInventoryDigest");
    expect(bootstrap).toContain("drInventoryDigest");
    expect(bootstrap).toContain("manifestDigest");
    expect(bootstrap).not.toContain(
      'test "$primary_storage_objects" = "0"',
    );
    expect(bootstrap).not.toContain(
      'test "$former_staging_storage_objects" = "0"',
    );
  });

  it("releases application-schema locks before the remote bootstrap reset", () => {
    const bootstrap = workflowJob(disasterRecovery, "bootstrap");
    const splitSchemaDrop = bootstrap.indexOf(
      "name: Drop large application schemas before DR reset",
    );
    const reset = bootstrap.indexOf(
      'supabase db reset --db-url "$DR_DIRECT_URL" --no-seed --yes',
    );

    expect(splitSchemaDrop).toBeGreaterThan(-1);
    expect(splitSchemaDrop).toBeLessThan(reset);
    expect(bootstrap).toContain("for schema in app_private internal; do");
    expect(bootstrap).toContain(
      'drop schema if exists \\"$SCHEMA\\" cascade',
    );
  });

  it("disables Vercel Git auto-deploy only for main", () => {
    expect(vercel.git.deploymentEnabled).toEqual({ main: false });
  });

  it("waits for the hosted branch action and stable database before Preview migrations", () => {
    expect(ephemeralPreview).toContain("preview_project_status");
    expect(ephemeralPreview).toContain("ACTIVE_HEALTHY|MIGRATIONS_FAILED");
    expect(ephemeralPreview).toContain(
      '[ "$preview_project_status" = "ACTIVE_HEALTHY" ]',
    );

    const stability = ephemeralPreview.indexOf(
      "name: Wait for Preview Branch database stability",
    );
    const migrations = ephemeralPreview.indexOf(
      "name: Apply reviewed migrations and synthetic fixtures",
    );
    const stabilityStep = ephemeralPreview.slice(stability, migrations);

    expect(stability).toBeGreaterThan(-1);
    expect(stability).toBeLessThan(migrations);
    expect(stabilityStep).toContain("for attempt in $(seq 1 12); do");
    expect(stabilityStep).toContain("stable_connections");
    expect(stabilityStep).toContain(
      'supabase migration list --db-url "$EPHEMERAL_DATABASE_URL"',
    );
    expect(stabilityStep).toContain('[ "$stable_connections" -ge 2 ]');

    const migrationHistory = ephemeralPreview.indexOf(
      "name: Verify isolated migration history",
    );
    const migrationStep = ephemeralPreview.slice(migrations, migrationHistory);

    expect(migrationStep).toContain("max_attempts=3");
    expect(migrationStep).toContain(
      "terminating connection due to administrator command|Connection timed out|failed to connect to postgres",
    );
    expect(migrationStep).toContain(
      "Preview migration push failed with a non-transient error.",
    );
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
    const catalogTranslationSmoke = ephemeralPreview.indexOf(
      "name: Run isolated catalog translation glossary smoke",
    );
    const syntheticSmoke = ephemeralPreview.indexOf(
      "name: Run synthetic OAuth and delivery smoke tests",
    );

    expect(deployPreview).toBeGreaterThan(-1);
    expect(deployPreview).toBeLessThan(readOnlySmoke);
    expect(readOnlySmoke).toBeLessThan(catalogTranslationSmoke);
    expect(catalogTranslationSmoke).toBeLessThan(syntheticSmoke);
    expect(ephemeralPreview).toContain(
      "PRODUCTION_BASE_URL: ${{ steps.vercel-preview.outputs.url }}",
    );
    expect(ephemeralPreview).toContain('SMOKE_SKIP_DOMAIN_REDIRECTS: "true"');
    expect(ephemeralPreview).toContain('PRODUCTION_TEST_QR_REQUIRED: "false"');
    expect(ephemeralPreview).toContain("run: npm run production:smoke");
    expect(ephemeralPreview).toContain(
      "CATALOG_TRANSLATION_SYNTHETIC_CONFIRMATION: EPHEMERAL_PREVIEW_ONLY",
    );
    expect(ephemeralPreview).toContain(
      "run: npm run preview:catalog-translation-smoke",
    );
  });

  it("attaches matching Preview to the PR branch and gates optional Azure smoke", () => {
    const deployPreview = ephemeralPreview.slice(
      ephemeralPreview.indexOf("name: Deploy matching Vercel Preview"),
      ephemeralPreview.indexOf("name: Run matching Preview read-only smoke"),
    );

    expect(ephemeralPreview).toContain(
      "PREVIEW_GIT_BRANCH: ${{ github.event.pull_request.head.ref || github.ref_name }}",
    );
    expect(deployPreview).toContain(
      'git switch -C "$PREVIEW_GIT_BRANCH" "$preview_head"',
    );
    expect(deployPreview).toContain(
      "Vercel did not attach the matching Preview to the requested Git branch.",
    );
    expect(deployPreview).toContain('--meta "githubDeployment=1"');
    expect(deployPreview).toContain(
      '--meta "githubCommitRef=$PREVIEW_GIT_BRANCH"',
    );
    for (const name of [
      "AI_TRANSLATION_PROVIDER",
      "AZURE_TRANSLATOR_KEY",
      "AZURE_TRANSLATOR_REGION",
      "CATALOG_TRANSLATION_ENABLED",
    ]) {
      expect(deployPreview).toContain(name);
    }
    expect(deployPreview).not.toContain(
      '--env "AI_TRANSLATION_PROVIDER=$AI_TRANSLATION_PROVIDER"',
    );
    expect(deployPreview).not.toContain(
      '--build-env "AI_TRANSLATION_PROVIDER=$AI_TRANSLATION_PROVIDER"',
    );
    expect(ephemeralPreview).not.toContain(
      "AI_TRANSLATION_PROVIDER: vercel-ai-gateway",
    );
    expect(deployPreview).toContain("configured_translation_envs=0");
    expect(deployPreview).toContain(
      "Matching Preview has incomplete catalog translation configuration",
    );
    expect(ephemeralPreview).toContain(
      "if: steps.vercel-auth.outputs.enabled == 'true' && steps.vercel-preview.outputs.translation_enabled == 'true'",
    );
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
    expect(cleanup.match(/\.deployments \| type/gu)).toHaveLength(2);
    expect(cleanup).toContain(".deployments | length == 0");
    expect(cleanup).toContain("verifying final state");
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

function workflowJob(source, jobName) {
  const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(new RegExp(
    `^  ${escaped}:\\r?\\n[\\s\\S]*?(?=^  [a-z0-9-]+:\\r?$|(?![\\s\\S]))`,
    "imu",
  ));
  if (!match) throw new Error(`WORKFLOW_JOB_NOT_FOUND_${jobName}`);
  return match[0];
}
