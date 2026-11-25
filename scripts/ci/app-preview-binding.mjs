import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PREVIEW_BINDING, verifyPreviewConfiguration } from "./delivery-preview-binding.mjs";
import { previewPublicOrigins } from "./delivery-preview-deployment.mjs";

const repo = "KenLeeYa/Stallorder-Platform";
const headBranch = "codex/dependency-integration-20261123";
const repairBranch = "codex/app-release-recovery-20261123";
const promotionGitBranch = "codex/preview-pr-414-20261123";
const recoveryPromotionBranch = "codex/pr422-recovery-preview";
const menuBranch = "codex/pr365-menu-search";
const menuPromotionBranch = "codex/pr423-menu-search-preview";
const menuMainBase = "0079effa188847f2d3c832c8413e59b82ba5689c";
const repairBase = "6c7c0524c4e75b2dc06295e2f90303fee4a629f2";
const stagingBase = "04c6c4678767ad23b2f2d4acbed7157b01250e1b";
const mainBase = "bf42bdfb10974d8fe57ef3509d2d3dd4d7cef4fa";
const project = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP";
const team = "team_MMfsiG94K9Zy3e6w7Ccc9xY4";
const sha = /^[a-f0-9]{40}$/;
const ref = /^[a-z]{20}$/;

export function appPreviewEvent(event, env) {
  assert.equal(env.GITHUB_EVENT_NAME, "pull_request");
  assert.equal(env.GITHUB_REPOSITORY, repo);
  const pr = event.pull_request;
  assert.equal(pr.head.repo.full_name, repo);
  assert.equal(pr.base.repo.full_name, repo);
  assert.ok(sha.test(pr.head.sha) && sha.test(env.GITHUB_SHA));
  const integration = pr.number === 413 && pr.head.ref === headBranch
    && pr.base.ref === "staging" && pr.base.sha === stagingBase;
  const repair = pr.number === 415 && pr.head.ref === repairBranch
    && pr.base.ref === "staging" && pr.base.sha === repairBase;
  const reportScope = pr.number === 416 && pr.head.ref === "codex/pr365-pr366-phase1"
    && pr.base.ref === "staging" && pr.base.sha === "bb047ce713be8f026057b5727e2c9196e99497c6";
  const settlement = pr.number === 418 && pr.head.ref === "codex/next-release-evidence"
    && pr.base.ref === "staging" && pr.base.sha === "7b0198124eece0032eec4a064cc1393899078a70";
  const batchPromotion = pr.number === 419 && pr.head.ref === "staging"
    && pr.base.ref === "main" && pr.base.sha === "b203d3cd6de8a3b4026f815fd297a00bb2204dda";
  const promotion = pr.number === 414 && pr.head.ref === "staging" && pr.base.ref === "main" && pr.base.sha === mainBase;
  const recoveryFix = pr.number === 421 && pr.head.ref === "codex/recovery-loader-fix"
    && pr.base.ref === "staging" && pr.base.sha === "e94890556e37dc0afbaffcacb0a1176ad26213af";
  const recoveryPromotion = pr.number === 422 && pr.head.ref === "staging"
    && pr.base.ref === "main" && pr.base.sha === "bdd968cf3fceb6d392e003e32d8f602f633f7541";
  const menu = pr.number === 417 && pr.head.ref === menuBranch && pr.base.ref === "staging"
    && pr.base.sha === "d59f693fa4d6273f30b3bb8de08ad28f7cb4dddc";
  const menuPromotion = pr.number === 423 && pr.head.ref === "staging"
    && pr.base.ref === "main" && pr.base.sha === menuMainBase;
  assert.ok(menu || menuPromotion || integration || repair || reportScope || settlement || promotion || batchPromotion || recoveryFix || recoveryPromotion,
    "Unreviewed application Preview source");
  assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]*$/);
  return {
    head: pr.head.sha,
    base: pr.base.sha,
    branch: pr.head.ref,
    gitBranch: menuPromotion ? menuPromotionBranch : recoveryPromotion ? recoveryPromotionBranch : batchPromotion ? "codex/pr419-app-batch1-preview" : promotion ? promotionGitBranch : pr.head.ref,
    resource: "pr-" + pr.number + "-app-" + env.GITHUB_RUN_ID + "-" + env.GITHUB_RUN_ATTEMPT,
  };
}

export function ownedBranch(branches, binding) {
  assert.ok(Array.isArray(branches) && branches.length <= 200);
  const matches = branches.filter(branch => branch.name === binding.resource);
  if (matches.length === 0) return null;
  assert.equal(matches.length, 1);
  const branch = matches[0];
  assert.match(branch.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.match(branch.project_ref, ref);
  assert.notEqual(branch.project_ref, PREVIEW_BINDING.parent);
  assert.notEqual(branch.project_ref, PREVIEW_BINDING.project);
  assert.equal(branch.parent_project_ref, PREVIEW_BINDING.parent);
  assert.equal(branch.git_branch, binding.gitBranch);
  assert.equal(branch.is_default, false);
  assert.equal(branch.with_data, false);
  assert.equal(branch.persistent, false);
  return branch;
}

export function appDeployment(d, binding, env) {
  assert.equal(d.id, env.DELIVERY_DEPLOYMENT_ID);
  assert.match(d.id, /^dpl_[A-Za-z0-9]+$/);
  assert.equal(d.projectId, project);
  const owners = [d.teamId, d.ownerId, d.team?.id].filter(value => value !== undefined);
  assert.ok(owners.length > 0 && owners.every(owner => owner === team));
  assert.ok(d.target === null || d.target === "preview");
  assert.equal(d.meta.githubCommitSha, env.GITHUB_SHA);
  assert.equal(d.meta.githubCommitRef, binding.branch);
  assert.equal(d.meta.stallorderPreviewRun, env.GITHUB_RUN_ID);
  assert.equal(d.meta.stallorderPreviewResource, binding.resource);
  return previewPublicOrigins(d.url.startsWith("https://") ? d.url : "https://" + d.url);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function jsonInput() {
  const bytes = readFileSync(0);
  assert.ok(bytes.length <= 2 * 1024 * 1024);
  return JSON.parse(bytes);
}

function main(mode, env) {
  const binding = appPreviewEvent(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")), env);
  assert.equal(env.SUPABASE_PARENT_PROJECT_REF, PREVIEW_BINDING.parent);
  const input = () => jsonInput();
  if (mode === "source") {
    assert.equal(git("rev-parse", "HEAD"), env.GITHUB_SHA);
    assert.equal(git("rev-parse", "HEAD^1"), binding.base);
    assert.equal(git("rev-parse", "HEAD^2"), binding.head);
    assert.equal(git("rev-parse", "HEAD^{tree}"), git("rev-parse", binding.head + "^{tree}"));
    assert.equal(git("merge-base", binding.head, "42f1ec92ae31f56883f62c04b9bbf8a74eb9ef6b"),
      "42f1ec92ae31f56883f62c04b9bbf8a74eb9ef6b");
    if (binding.gitBranch !== headBranch) git("merge-base", "--is-ancestor", mainBase, binding.head);
    if ([promotionGitBranch, "codex/pr419-app-batch1-preview", recoveryPromotionBranch, menuPromotionBranch].includes(binding.gitBranch)) {
      assert.equal(git("rev-parse", "refs/remotes/origin/" + binding.gitBranch + "^{tree}"),
        git("rev-parse", binding.head + "^{tree}"));
    }
    if (binding.branch === "codex/pr365-pr366-phase1") git("merge-base", "--is-ancestor", "b203d3cd6de8a3b4026f815fd297a00bb2204dda", binding.head);
    const allowed = new Set([
      "scripts/production-application-target.mjs", "scripts/lib/production-application-target.test.mjs",
      "src/components/report-navigation.tsx", "src/components/merchant-report-behavior.contract.test.tsx",
      ".github/workflows/ephemeral-preview.yml", "docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md",
      "docs/DEPENDENCY_HOTFIX_20261122.md", "package.json", "package-lock.json",
      "docs/PRODUCTION_ROLLBACK.md", "scripts/production-application-recovery-plan.mjs",
      "scripts/lib/production-application-recovery-plan.test.mjs", "scripts/lib/production-application-origin-receipt.mjs",
      "scripts/dependency-security.test.mjs", "scripts/ci/app-preview-binding.mjs",
      "scripts/ci/app-preview-binding.test.mjs", "scripts/ci/delivery-preview-binding.mjs",
      "scripts/lib/production-workflow-contract.test.mjs", "scripts/qa-preview-database-principal.ts",
      "scripts/qa-preview-database-principal.test.ts", "scripts/qa-preview-public-order.ts",
      "src/lib/rate-limit.ts", "src/lib/rate-limit.test.ts", "src/lib/authorization.ts",
      "src/server/resilience/health-authorization.ts", "src/app/api/health/route.ts",
      "scripts/configure-preview-order-runtime.ts", "scripts/configure-preview-order-runtime.test.ts",
    ]);
    const recoveryFiles = new Set([
      "scripts/production-application-target.mjs", "scripts/lib/production-application-target.test.mjs",
      "scripts/ci/app-preview-binding.mjs", "scripts/ci/app-preview-binding.test.mjs",
      ".github/workflows/ephemeral-preview.yml", ".github/workflows/production-qr-recheck.yml",
      "scripts/lib/production-workflow-contract.test.mjs", "docs/PRODUCTION_ROLLBACK.md",
      "docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md",
    ]);
    const recovery = ["codex/recovery-loader-fix", recoveryPromotionBranch].includes(binding.gitBranch);
    const menu = [menuBranch, menuPromotionBranch].includes(binding.gitBranch);
    const menuFiles = new Set([
      "src/components/qr-order-menu.tsx", "src/lib/qr-order-i18n.ts", "e2e/public-cache.spec.ts",
      ".github/workflows/ephemeral-preview.yml", "scripts/ci/app-preview-binding.mjs", "scripts/ci/app-preview-binding.test.mjs",
      ".github/workflows/production-qr-menu-search.yml", "scripts/qa-qr-menu-search.ts", "scripts/qa-production-qr-menu.ts",
      "scripts/qa-preview-public-order.ts", "scripts/lib/production-workflow-contract.test.mjs",
      "scripts/production-application-recovery-plan.mjs", "scripts/lib/production-application-recovery-plan.test.mjs",
      "docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md", "docs/PRODUCTION_ROLLBACK.md",
    ]);
    if (menu) git("merge-base", "--is-ancestor", menuMainBase, binding.head);
    const paths = menu ? menuFiles : recovery ? recoveryFiles : allowed;
    assert.ok(git("diff", "--name-only", binding.base, binding.head).split("\n").every(name => paths.has(name)));
    console.log(JSON.stringify({ resource: binding.resource, branch: binding.branch, gitBranch: binding.gitBranch }));
  } else if (mode === "branch") {
    const branch = ownedBranch(input(), binding);
    if (branch) console.log(JSON.stringify({
      id: branch.id, project: branch.project_ref,
      ready: branch.preview_project_status === "ACTIVE_HEALTHY"
        && ["ACTIVE_HEALTHY", "MIGRATIONS_FAILED"].includes(branch.status),
    }));
  } else if (mode === "config") {
    assert.match(env.APP_PREVIEW_CHILD, ref);
    assert.notEqual(env.APP_PREVIEW_CHILD, PREVIEW_BINDING.parent);
    verifyPreviewConfiguration(input(), env.APP_PREVIEW_CHILD);
  } else if (mode === "deployment" || mode === "cleanup-deployment") {
    const deployment = input();
    const origin = appDeployment(deployment, binding, env);
    if (mode === "deployment") {
      assert.equal(deployment.readyState, "READY");
      assert.equal(origin, env.DELIVERY_DEPLOYMENT_URL);
    }
    console.log(origin);
  } else assert.fail("Invalid application Preview operation");
}

if (process.argv[1] && process.argv[1].endsWith("app-preview-binding.mjs")) {
  try {
    main(process.argv[2], process.env);
  } catch {
    console.error("APP_PREVIEW_BINDING_REJECTED");
    process.exitCode = 1;
  }
}
