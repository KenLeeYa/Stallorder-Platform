import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "vitest";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const workflow = load(readFileSync(new URL("../../.github/workflows/production-application-release.yml", import.meta.url), "utf8"));
const step = workflow.jobs.apply.steps.find(entry => entry.name === "Promote approved application deployment and smoke Production");
const bash = process.platform === "win32" && existsSync("C:/Program Files/Git/bin/bash.exe")
  ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";

function execute(failure = "", retirement = false) {
  return spawnSync(bash, ["--noprofile", "--norc", "-c", `
    export VERCEL_TOKEN=fixture APPROVED_PRODUCTION_DEPLOYMENT=https://candidate.vercel.app
    export APPLICATION_RECOVERY_DEPLOYMENT=dpl_verified RELEASE_ROLLBACK_DEPLOYMENT=dpl_verified
    export RETIRE_DR_RUNTIME=${retirement ? "true" : "false"}
    ${retirement ? "export RETIREMENT_RECOVERY_DEPLOYMENT=https://retirement.vercel.app" : "unset RETIREMENT_RECOVERY_DEPLOYMENT"}
    smoke_count=0
    vercel() {
      echo "vercel $*"
      if [ "$1" = rollback ] || [ "$2" = dpl_verified ]; then
        case "$FAILURE" in rollbackTimeout) return 29;; esac
        return 0
      fi
      if [ "$1" = promote ]; then
        case "$FAILURE" in promoteTimeout|pending|unknown|unapplied) return 17;; esac
      fi
      return 0
    }
    node() {
      echo "node $*"
      if [ "$2" = settled ]; then
        case "$FAILURE" in pending|unknown|pendingAfterSuccess) return 41;; esac
      fi
      if [ "$2" = verify ] && [ "$FAILURE" = preflight ]; then return 19; fi
      if [ "$2" = unchanged ] && [ "$FAILURE" != unapplied ]; then return 33; fi
      if [ "$2" = recovered ] && [ "$FAILURE" = recoveryReadback ]; then return 31; fi
      return 0
    }
    npm() {
      smoke_count=$((smoke_count + 1)); echo "smoke $smoke_count"
      if [ "$smoke_count" = 1 ]; then
        case "$FAILURE" in smoke|rollbackTimeout|recoveryReadback|recoveryHealth) return 23;; esac
      fi
      if [ "$smoke_count" = 2 ] && [ "$FAILURE" = recoveryHealth ]; then return 24; fi
      return 0
    }
    ${step.run.replace(/\r/g, "")}
  `], { encoding: "utf8", timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot, PATH: "", FAILURE: failure } });
}

test("normal smoke failure recovers only the exact Plan-bound deployment and verifies recovery", () => {
  const result = execute("smoke");
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /vercel promote dpl_verified --yes/);
  assert.doesNotMatch(result.stdout, /vercel rollback --yes/);
  assert.match(result.stdout, / recovered /);
  assert.match(result.stdout, /smoke 2/);
});

for (const failure of ["pending", "unknown", "pendingAfterSuccess"]) {
  test(`${failure} provider outcome never permits a recovery write`, () => {
    const result = execute(failure);
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /vercel (?:rollback|promote dpl_verified)/);
    assert.equal((result.stdout.match(/ settled /g) || []).length, 1);
  });
}

test("an applied CLI timeout may recover only after exact provider termination is proved", () => {
  const result = execute("promoteTimeout");
  assert.equal(result.status, 17);
  assert.match(result.stdout, /vercel promote dpl_verified --yes/);
  assert.ok(result.stdout.indexOf(" settled ") < result.stdout.indexOf("vercel promote dpl_verified"));
});

test("failed prepromotion verification prevents both promotion and recovery", () => {
  const result = execute("preflight");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /vercel (promote|rollback)/);
});

for (const failure of ["rollbackTimeout", "recoveryReadback", "recoveryHealth"]) {
  test(`${failure} remains failed and never retries recovery`, () => {
    const result = execute(failure);
    assert.notEqual(result.status, 0);
    assert.equal((result.stdout.match(/vercel promote dpl_verified/g) || []).length, 1);
    if (failure === "rollbackTimeout") assert.match(result.stdout, / recovered /);
  });
}

test("normal success verifies promotion and does not recover", () => {
  const result = execute();
  assert.equal(result.status, 0);
  assert.match(result.stdout, / promoted /);
  assert.doesNotMatch(result.stdout, /vercel (?:rollback|promote dpl_verified)/);
});

test("retirement still uses its original independently bound recovery target", () => {
  const result = execute("smoke", true);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /vercel rollback https:\/\/retirement\.vercel\.app --yes/);
  assert.doesNotMatch(result.stdout, /vercel promote dpl_verified/);
});

test("a terminal unapplied operation leaves the healthy baseline without a second write", () => {
  const result = execute("unapplied");
  assert.equal(result.status, 17);
  assert.match(result.stdout, / unchanged /);
  assert.doesNotMatch(result.stdout, /vercel promote dpl_verified/);
});
