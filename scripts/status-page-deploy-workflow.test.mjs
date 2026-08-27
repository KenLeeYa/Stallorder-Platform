import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/status-page-deploy.yml", "utf8");

describe("status page protected workflow", () => {
  it("passes dispatch inputs through step environment variables", () => {
    const validationStep = workflow.match(
      /- name: Validate protected invocation[\s\S]*?\n\s+- uses: actions\/checkout@/,
    )?.[0];

    expect(validationStep).toBeDefined();
    expect(validationStep).toContain("INPUT_OPERATION");
    expect(validationStep).toContain("INPUT_CONFIRMATION");
    expect(validationStep).toContain("INPUT_PLAN_RUN_ID");
    expect(validationStep?.split("run: |", 2)[1]).not.toMatch(/\$\{\{\s*inputs\./);
  });
});
