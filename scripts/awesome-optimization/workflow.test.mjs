import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { expect, test } from "vitest";

const workflow = yaml.load(readFileSync(".github/workflows/ephemeral-preview.yml", "utf8"));
test("ordinary PR cannot enter any Preview resource or secrets job", () => {
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.on.workflow_dispatch.inputs.approve_external_preview.default).toBe(false);
  for (const job of Object.values(workflow.jobs)) {
    expect(job.if).toContain("github.event_name == 'workflow_dispatch' &&");
    expect(job.if).toContain("inputs.approve_external_preview == true &&");
    expect(job.environment.name).toBe("Preview");
  }
});

test("manual cleanup retains exact resource name and metadata ownership", () => {
  const cleanup = workflow.jobs.cleanup;
  expect(cleanup.if).toContain("inputs.operation == 'cleanup'");
  expect(cleanup.env.PREVIEW_RESOURCE_KEY).toBe("pr-${{ inputs.cleanup_pr_number }}");
  expect(cleanup.env.PREVIEW_BRANCH_NAME).toBe("pr-${{ inputs.cleanup_pr_number }}-oauth-delivery");
  const source = cleanup.steps.map((step) => step.run ?? "").join("\n");
  expect(source).toContain('stallorderPreviewResource=$PREVIEW_RESOURCE_KEY');
  expect(source).toContain('list "$VERCEL_PROJECT_ID"');
  expect(source).toContain('^\u005b1-9\u005d\u005b0-9\u005d{0,6}$');
  expect(source).toContain('.deployments | length == 0');
  expect(source).toContain('.state == "closed" and .number == $number and .head.repo.full_name == $repository');
});

test("PR366 paired Preview stays synthetic with deferred governance and real LINE Pay disabled", () => {
  const deploy = workflow.jobs.validate.steps.find((step) => step.id === "vercel-preview").run;
  const start = deploy.indexOf('if [ "$PREVIEW_GIT_BRANCH" = "codex/integrated-production-20261002" ]; then');
  expect(start).toBeGreaterThan(-1);
  const isolated = deploy.slice(start, deploy.indexOf("\n          fi", start));
  for (const entry of ["APP_ENV=test", "COMPLIANCE_ENABLED=false", "COMPLIANCE_DELETION_DRY_RUN=true",
    "LINE_PLATFORM_ENABLED=false", "LINE_PAY_OPERATIONAL_STATUS=MAINTENANCE",
    "PAYMENT_LINE_PAY_MERCHANT_ID=", "PAYMENT_LINE_PAY_CHANNEL_SECRET="]) expect(isolated).toContain(`"${entry}"`);
  expect(isolated).toContain('line_env_args+=(--build-env "$entry" --env "$entry")');
});

test("synthetic public ordering secrets are generated only for the PR366 child", () => {
  const steps = workflow.jobs.validate.steps;
  const index = steps.findIndex((step) => step.name === "Configure PR366 synthetic public ordering in the owned child only");
  expect(index).toBeGreaterThan(steps.findIndex((step) => step.name === "Apply Preview-only OAuth and delivery fixture"));
  expect(steps[index].if).toBe("github.ref_name == 'codex/integrated-production-20261002'");
  for (const guard of ['!= "$SUPABASE_PARENT_PROJECT_REF"', '!= "daeqwtpaxcebmtwxqdkj"', 'process.env.ABUSE_HASH_SECRET', 'process.env.TOKEN_DERIVATION_SECRET', 'APP_ENV=test', 'TURNSTILE_ALLOW_TEST_KEYS=true', '--project-ref "$project_ref" --env-file "$secret_file"', "trap 'rm -f"]) {
    expect(steps[index].run).toContain(guard);
  }
  expect(steps[index].run).not.toContain("set -x");
  const generated = steps.find((step) => step.name === "Generate isolated Preview-only secrets").run;
  for (const name of ['ABUSE_HASH_SECRET', 'TOKEN_DERIVATION_SECRET']) expect(generated).toContain(name);
  expect(generated).toContain('openssl rand -hex 32');
  expect(index).toBeLessThan(steps.findIndex((step) => step.name === "Deploy Edge Functions to isolated branch"));
});

test("actual PR366 browser phases stay before cleanup and private handoffs stay outside artifacts", () => {
  const steps = workflow.jobs.validate.steps;
  const qa = steps.find(step => step.name === "Capture fresh PR366 paired target and run browser QA before cleanup");
  expect(qa.run).toContain('PR366_PRIVATE_FIXTURE_DIR="$(mktemp -d)"');
  expect(qa.run).toContain('chmod 700 "$PR366_PRIVATE_FIXTURE_DIR"');
  for (const phase of ['prepare-cash-shift', 'hours-open', 'hours-closed']) expect(qa.run).toContain(phase);
  expect(qa.run).toContain('JSON.stringify(open.after)!==JSON.stringify(closed.before)');
  expect(qa.run).toContain('fixture-original-hours.json');
  const artifact = steps.find(step => step.name === "Preserve PR366 baseline and actual browser evidence");
  expect(artifact.with.path).not.toContain('PR366_PRIVATE_FIXTURE_DIR');
  expect(steps.indexOf(qa)).toBeLessThan(steps.indexOf(artifact));
});

test("both Preview jobs read actual approval rules before mutations; always cleanup cannot bypass failure", () => {
  for (const job of Object.values(workflow.jobs)) {
    const guardIndex = job.steps.findIndex((step) => step.id === "preview-approval");
    expect(guardIndex).toBeGreaterThan(0);
    expect(job.steps.slice(0, guardIndex).some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(true);
    expect(job.steps[guardIndex].run).toBe("node scripts/awesome-optimization/preview-approval.mjs");
    expect(job.steps[guardIndex].env.GH_TOKEN).toBe("${{ github.token }}");
    expect(job.steps.slice(0, guardIndex).some((step) => /supabase (?:branches|db|functions)|vercel@/u.test(step.run ?? ""))).toBe(false);
    for (const step of job.steps.filter((step) => step.if?.includes("always()"))) expect(step.if).toContain("steps.preview-approval.outcome == 'success'");
    for (const step of job.steps.filter((step) => step.uses)) expect(step.uses).toMatch(/@[a-f0-9]{40}(?:\s|$)/u);
  }
  const ci = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
  for (const step of ci.jobs.verify.steps.filter((step) => step.uses)) expect(step.uses).toMatch(/@[a-f0-9]{40}(?:\s|$)/u);
});
