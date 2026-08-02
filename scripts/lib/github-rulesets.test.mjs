import { describe, expect, it } from "vitest";
import {
  buildStallOrderRulesets,
  summarizeRulesetPlan,
} from "./github-rulesets.mjs";

describe("GitHub branch rulesets", () => {
  it("protects main and staging without an administrator bypass", () => {
    const rulesets = buildStallOrderRulesets();
    expect(rulesets.map((ruleset) => ruleset.conditions.ref_name.include[0])).toEqual([
      "refs/heads/main",
      "refs/heads/staging",
    ]);
    expect(rulesets.every((ruleset) => ruleset.bypass_actors.length === 0)).toBe(true);
  });

  it("requires PRs and the existing CI, Preview and Vercel checks", () => {
    for (const ruleset of buildStallOrderRulesets()) {
      const pullRequest = ruleset.rules.find((rule) => rule.type === "pull_request");
      const statusChecks = ruleset.rules.find(
        (rule) => rule.type === "required_status_checks",
      );
      expect(pullRequest.parameters.required_approving_review_count).toBe(0);
      expect(statusChecks.parameters.required_status_checks).toEqual([
        { context: "verify" },
        { context: "validate" },
        { context: "Vercel" },
      ]);
      expect(statusChecks.parameters.strict_required_status_checks_policy).toBe(true);
    }
  });

  it("refuses to overwrite a managed ruleset with the same name", () => {
    const desired = buildStallOrderRulesets();
    const plan = summarizeRulesetPlan([{ name: desired[0].name }], desired);
    expect(plan[0].action).toBe("CONFLICT");
    expect(plan[1].action).toBe("CREATE");
  });
});
