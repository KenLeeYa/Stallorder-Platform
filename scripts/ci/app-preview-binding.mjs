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
const webApplicationsBranch = "codex/web-shared-contracts-20261127";
const webApplicationsPayload = "b4a319066c9b5322ecae6cf77335dc6751fef3b6";
const catalogBranch = "codex/web-catalog-after-print-20261127";
const catalogPromotion = "codex/web-catalog-promotion-20261128";
const catalogPayload = "8789ddcbf33d92b1fd1f748d7efb72d6a6c58348";
const nextTicketBranch = "codex/webprnt-next-ticket-20261128";
const nextTicketPromotion = "codex/webprnt-next-ticket-promotion-20261128";
const nextTicketPayload = "e0054c84f65318971fd6e5404abc4d08f4ab2325";
const fastPrintBranch = "codex/webprnt-claim-20261128";
const fastPrintPromotion = "codex/webprnt-claim-promotion-20261128";
const fastPrintPayload = "9a17183217e10267b86069de865f70751f49dc66";
const checkoutPrintBranch = "codex/checkout-print-hotfix-20261127";
const printReleasePayload = "78474fa6e52ca3dced72286d33a0739e344aefb6";
const printReleaseBranch = "codex/print-release-baseline-20261127";
const printReleasePromotion = "codex/pr431-print-release-preview";
const checkoutPrintPayload = "f29ea3965352f051ef335d92e06c29bb55cb1cc6";
const holdPrintBranch = "codex/hold-print-424-20261127";
const servingBase = "750d205f9a9338bdb3c04dedc2fdbd3272862359";
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
  const holdPrint = pr.number === 425 && pr.head.ref === holdPrintBranch
    && pr.base.ref === "staging" && pr.base.sha === "62f473c9c5779117875668716d7aa75b913eba74"
    && pr.head.sha === env.HOLD_PRINT_PR425_HEAD;
  const webApplications = pr.number === 426 && pr.head.ref === webApplicationsBranch && pr.base.ref === "staging"
    && sha.test(pr.base.sha) && pr.base.sha === env.WEB_APPLICATIONS_PR426_BASE && pr.head.sha === env.WEB_APPLICATIONS_PR426_HEAD;
  const webPromotion = Number.isSafeInteger(pr.number) && pr.number > 426 && String(pr.number) === env.WEB_APPLICATIONS_PROMOTION_PR
    && pr.head.ref === "staging" && pr.base.ref === "main" && pr.base.sha === servingBase
    && pr.head.sha === env.WEB_APPLICATIONS_PROMOTION_HEAD;
  const catalog = pr.number === 432 && pr.head.ref === catalogBranch && pr.base.ref === "staging"
    && pr.base.sha === "3a31fbfdf9a7ea35cdc916089c917cbd46283624" && pr.head.sha === env.WEB_CATALOG_PR432_HEAD;
  const catalogRelease = Number.isSafeInteger(pr.number) && pr.number > 434 && String(pr.number) === env.WEB_CATALOG_PROMOTION_PR
    && pr.head.ref === "staging" && pr.base.ref === "main" && pr.base.sha === "a55e5ff8795d539d24d1ac27299e2157b78e4059"
    && pr.head.sha === env.WEB_CATALOG_PROMOTION_HEAD;
  const nextTicket = pr.number === 436 && pr.head.ref === nextTicketBranch && pr.base.ref === "staging"
    && pr.base.sha === "13a18caa5fd9914de52a49c518f67b514a5f3755" && pr.head.sha === env.WEBPRNT_NEXT_PR436_HEAD;
  const nextRelease = Number.isSafeInteger(pr.number) && pr.number > 436 && String(pr.number) === env.WEBPRNT_NEXT_PROMOTION_PR
    && pr.head.ref === "staging" && pr.base.ref === "main" && pr.base.sha === "7a0c7867e3e076558b1f23e162f047a0f04a7792"
    && pr.head.sha === env.WEBPRNT_NEXT_PROMOTION_HEAD;
  const fastPrint = pr.number === 433 && pr.head.ref === fastPrintBranch && pr.base.ref === "staging"
    && pr.base.sha === "63557efdc7523a296e760f931fe97b29326892ff" && pr.head.sha === env.WEBPRNT_CLAIM_PR433_HEAD;
  const fastPromotion = Number.isSafeInteger(pr.number) && pr.number > 433 && String(pr.number) === env.WEBPRNT_CLAIM_PROMOTION_PR
    && pr.head.ref === "staging" && pr.base.ref === "main" && pr.base.sha === "dc752e718a1a04c096637c8d39757aa8eb062bfa"
    && pr.head.sha === env.WEBPRNT_CLAIM_PROMOTION_HEAD;
  const checkoutPrint = pr.number === 429 && pr.head.ref === checkoutPrintBranch && pr.base.ref === "staging"
    && pr.base.sha === "434e798642b1d6c56a55e7bfae4c1e31f0490a98" && pr.head.sha === env.CHECKOUT_PRINT_PR429_HEAD;
  const printRelease = pr.number === 430 && pr.head.ref === printReleaseBranch && pr.base.ref === "staging"
    && pr.base.sha === "756fbc9b027fceacde99002734ffa77948bcac1a" && pr.head.sha === env.PRINT_RELEASE_PR430_HEAD;
  const printPromotion = pr.number === 431 && pr.head.ref === "staging" && pr.base.ref === "main"
    && pr.base.sha === "a835e3c9c58e2b9b1fc40fa83c16d3e24262906f" && pr.head.sha === env.PRINT_RELEASE_PR431_HEAD;
  assert.ok(nextTicket || nextRelease || catalog || catalogRelease || fastPrint || fastPromotion || printRelease || printPromotion || checkoutPrint || webApplications || webPromotion || holdPrint || menu || menuPromotion || integration || repair || reportScope || settlement || promotion || batchPromotion || recoveryFix || recoveryPromotion,
    "Unreviewed application Preview source");
  assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]*$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]*$/);
  return {
    head: pr.head.sha,
    base: pr.base.sha,
    branch: pr.head.ref,
    gitBranch: nextRelease ? nextTicketPromotion : catalogRelease ? catalogPromotion : fastPromotion ? fastPrintPromotion : printPromotion ? printReleasePromotion : webPromotion ? "codex/pr" + pr.number + "-web-applications-preview" : menuPromotion ? menuPromotionBranch : recoveryPromotion ? recoveryPromotionBranch : batchPromotion ? "codex/pr419-app-batch1-preview" : promotion ? promotionGitBranch : pr.head.ref,
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
    const webPromotion = /^codex\/pr[1-9][0-9]*-web-applications-preview$/.test(binding.gitBranch);
    const webApplications = binding.branch === webApplicationsBranch || webPromotion;
    if (webApplications) {
      git("merge-base", "--is-ancestor", webApplicationsPayload, binding.head);
      if (!webPromotion) assert.equal(git("rev-parse", binding.base + "^{tree}"), git("rev-parse", "62af67d5a24dbf62ce878a3b7c9af4a9c04d600a^{tree}"));
    }
    if (binding.gitBranch === nextTicketPromotion || binding.gitBranch === catalogPromotion || binding.gitBranch === fastPrintPromotion || binding.gitBranch === printReleasePromotion || webPromotion || [promotionGitBranch, "codex/pr419-app-batch1-preview", recoveryPromotionBranch, menuPromotionBranch].includes(binding.gitBranch)) {
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
      "scripts/qa-preview-public-order.ts", "scripts/qa-preview-public-order.test.ts", "scripts/lib/production-workflow-contract.test.mjs",
      "scripts/production-application-recovery-plan.mjs", "scripts/lib/production-application-recovery-plan.test.mjs",
      "docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md", "docs/PRODUCTION_ROLLBACK.md",
    ]);
    if (menu) git("merge-base", "--is-ancestor", menuMainBase, binding.head);
    const holdPrint = binding.branch === holdPrintBranch;
    const holdFiles = new Set([
      ".github/workflows/ephemeral-preview.yml", "docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md",
      "scripts/ci/app-preview-binding.mjs", "scripts/ci/app-preview-binding.test.mjs",
      "docs/PRODUCTION_ROLLBACK.md", "scripts/production-application-recovery-plan.mjs",
      "scripts/lib/production-application-recovery-plan.test.mjs",
    ]);
    const previewControls = new Set(["scripts/ci/app-preview-binding.mjs", "scripts/ci/app-preview-binding.test.mjs", ".github/workflows/ephemeral-preview.yml"]);
    const checkoutPrint = binding.branch === checkoutPrintBranch;
    if (checkoutPrint) git("merge-base", "--is-ancestor", checkoutPrintPayload, binding.head);
    const printRelease = [printReleaseBranch, printReleasePromotion].includes(binding.gitBranch);
    if (printRelease) git("merge-base", "--is-ancestor", printReleasePayload, binding.head);
    const fastPrint = [fastPrintBranch, fastPrintPromotion].includes(binding.gitBranch);
    if (fastPrint) git("merge-base", "--is-ancestor", fastPrintPayload, binding.head);
    const catalog = [catalogBranch, catalogPromotion].includes(binding.gitBranch);
    if (catalog) git("merge-base", "--is-ancestor", catalogPayload, binding.head);
    const nextTicket = [nextTicketBranch, nextTicketPromotion].includes(binding.gitBranch);
    if (nextTicket) git("merge-base", "--is-ancestor", nextTicketPayload, binding.head);
    const paths = nextTicket || catalog || fastPrint || printRelease || webApplications || checkoutPrint ? previewControls : holdPrint ? holdFiles : menu ? menuFiles : recovery ? recoveryFiles : allowed;
    const diffBase = nextTicket ? nextTicketPayload : catalog ? catalogPayload : fastPrint ? fastPrintPayload : printRelease ? printReleasePayload : checkoutPrint ? checkoutPrintPayload : webApplications ? webApplicationsPayload : holdPrint ? servingBase : binding.base;
    assert.ok(git("diff", "--no-renames", "--name-only", diffBase, binding.head).split("\n").every(name => paths.has(name)));
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
