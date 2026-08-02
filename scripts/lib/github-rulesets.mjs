const PROTECTED_BRANCHES = ["main", "staging"];
const REQUIRED_CHECKS = ["verify", "validate", "Vercel"];

export function buildStallOrderRulesets() {
  return PROTECTED_BRANCHES.map((branch) => ({
    name: `StallOrder ${branch} release gate`,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [`refs/heads/${branch}`],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["merge", "squash", "rebase"],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: false,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: true,
          required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
          strict_required_status_checks_policy: true,
        },
      },
    ],
  }));
}

export function summarizeRulesetPlan(existingRulesets, desiredRulesets) {
  if (!Array.isArray(existingRulesets) || !Array.isArray(desiredRulesets)) {
    throw new Error("RULESET_PLAN_INPUT_INVALID");
  }
  return desiredRulesets.map((desired) => {
    const matches = existingRulesets.filter((existing) => existing.name === desired.name);
    if (matches.length > 1) throw new Error("DUPLICATE_MANAGED_RULESET");
    return {
      name: desired.name,
      branch: desired.conditions.ref_name.include[0].replace("refs/heads/", ""),
      action: matches.length === 0 ? "CREATE" : "CONFLICT",
      requiredChecks: REQUIRED_CHECKS,
      pullRequestRequired: true,
      approvingReviewsRequired: 0,
      adminBypassConfigured: false,
    };
  });
}

export const MANAGED_RULESET_NAMES = Object.freeze(
  buildStallOrderRulesets().map((ruleset) => ruleset.name),
);
