import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildStallOrderRulesets,
  MANAGED_RULESET_NAMES,
  summarizeRulesetPlan,
} from "./lib/github-rulesets.mjs";
import { normalizeProtectedSecret } from "./lib/protected-secret.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const rollback = args.has("--rollback");
if (apply && rollback) fail("RULESET_MODE_INVALID");

const repository = required("GITHUB_REPOSITORY");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
  fail("GITHUB_REPOSITORY_INVALID");
}
const token = normalizeProtectedSecret(
  process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  "GITHUB_TOKEN",
).value;
const desiredRulesets = buildStallOrderRulesets();

try {
  if (rollback) {
    requireConfirmation("ROLLBACK_STALLORDER_BRANCH_RULESETS");
    await rollbackManagedRulesets();
  } else {
    const existing = await github(`/repos/${repository}/rulesets`);
    const plan = summarizeRulesetPlan(existing, desiredRulesets);
    await writePlan(plan);
    if (!apply) {
      console.log(JSON.stringify({ event: "github_ruleset_plan_created", plan }));
    } else {
      requireConfirmation("APPLY_STALLORDER_BRANCH_RULESETS");
      if (plan.some((entry) => entry.action !== "CREATE")) {
        throw new Error("MANAGED_RULESET_ALREADY_EXISTS");
      }
      await applyRulesets();
    }
  }
} catch (error) {
  console.error(JSON.stringify({
    event: "github_ruleset_operation_failed",
    reason: safeReason(error),
  }));
  process.exitCode = 1;
}

async function applyRulesets() {
  const created = [];
  try {
    for (const ruleset of desiredRulesets) {
      const response = await github(`/repos/${repository}/rulesets`, {
        method: "POST",
        body: JSON.stringify(ruleset),
      });
      created.push(response.id);
    }
  } catch (error) {
    await Promise.allSettled(
      created.map((rulesetId) =>
        github(`/repos/${repository}/rulesets/${rulesetId}`, { method: "DELETE" }),
      ),
    );
    throw error;
  }
  console.log(JSON.stringify({
    event: "github_rulesets_applied",
    names: MANAGED_RULESET_NAMES,
    rollbackConfirmation: "ROLLBACK_STALLORDER_BRANCH_RULESETS",
  }));
}

async function rollbackManagedRulesets() {
  const existing = await github(`/repos/${repository}/rulesets`);
  const managed = existing.filter((ruleset) => MANAGED_RULESET_NAMES.includes(ruleset.name));
  await Promise.all(
    managed.map((ruleset) =>
      github(`/repos/${repository}/rulesets/${ruleset.id}`, { method: "DELETE" }),
    ),
  );
  console.log(JSON.stringify({
    event: "github_rulesets_rolled_back",
    removedNames: managed.map((ruleset) => ruleset.name),
  }));
}

async function github(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`GITHUB_RULESET_API_${response.status}`);
  return response.json();
}

async function writePlan(plan) {
  const path = resolve("artifacts/github-ruleset-plan.json");
  await mkdir(resolve("artifacts"), { recursive: true });
  await writeFile(path, `${JSON.stringify({ repository, plan }, null, 2)}\n`, "utf8");
}

function requireConfirmation(expected) {
  if (process.env.GITHUB_RULESET_CONFIRMATION !== expected) {
    throw new Error(`CONFIRMATION_REQUIRED_${expected}`);
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name}_MISSING`);
  return value;
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  return /^[A-Z0-9_]+$/u.test(message) ? message : "GITHUB_RULESET_OPERATION_FAILED";
}

function fail(reason) {
  console.error(JSON.stringify({ event: "github_ruleset_operation_failed", reason }));
  process.exit(1);
}
