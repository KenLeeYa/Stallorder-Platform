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
