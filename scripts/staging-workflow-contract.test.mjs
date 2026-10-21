import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("independent Staging workflow boundaries", () => {
  it("fails closed before any old DR plan, approval or dependent mutation job", () => {
    for (const name of ["production-dr-operations", "production-dr-operator-entry"]) {
      const { jobs } = yaml.load(read(`.github/workflows/${name}.yml`));
      expect(jobs["retired-target"].steps[0].run).toContain("exit 1");
      expect(jobs.plan.needs).toBe("retired-target");
      expect(jobs.approval.needs).toBe("retired-target");
      for (const [key, job] of Object.entries(jobs)) {
        if (!["retired-target", "plan", "approval"].includes(key)) expect(job.needs).toBe("approval");
      }
    }
  });
  it("requires owner/main, immutable backup/plan, the writer lock and pinned reset CLI", () => {
    const workflow = yaml.load(read(".github/workflows/dr-staging-conversion.yml"));
    expect(workflow.concurrency).toEqual({ group: "production-dr-operations", "cancel-in-progress": false });
    expect(workflow.jobs.conversion.if).toContain("github.actor == github.repository_owner");
    expect(workflow.jobs.conversion.if).toContain("github.ref == 'refs/heads/main'");
    const steps = workflow.jobs.conversion.steps;
    expect(steps.find((step) => step.uses === "supabase/setup-cli@v1").with.version).toBe("2.109.1");
    expect(steps.find((step) => step.name === "Apply with backup, drift, Primary and provider boundaries").env)
      .toMatchObject({ PRODUCTION_APPROVAL_OPERATION: "dr-staging-conversion" });
    expect(JSON.stringify(steps)).not.toContain("PRIMARY_SUPABASE_DB_PASSWORD");
    expect(steps.find((step) => step.run === "node scripts/export-dr-database-urls.mjs --dr-only")).toBeDefined();
  });
  it("uploads the reviewed Git archive, never private runner files or decrypted backups", () => {
    const source = read("scripts/staging-runtime.mjs");
    expect(source).toContain('run("git", ["archive", "--format=tar", "--output=staging-conversion-private/source.tar", plan.sourceSha])');
    expect(source).toContain('"deploy", source, "--yes", "--target", "preview"');
    expect(source).not.toContain('"deploy", "."');
    for (const path of ["/staging-conversion-private/", "/approved-backup/", "/approved-transition-plan/"]) {
      expect(read(".gitignore")).toContain(path);
    }
  });
});
