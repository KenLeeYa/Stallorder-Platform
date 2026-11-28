import { describe, expect, it } from "vitest";
import { appDeployment, appPreviewEvent, ownedBranch } from "./app-preview-binding.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const headSha = "a".repeat(40);
const event = { pull_request: {
  number: 413,
  head: { ref: "codex/dependency-integration-20261123", sha: headSha, repo: { full_name: repository } },
  base: { ref: "staging", sha: "04c6c4678767ad23b2f2d4acbed7157b01250e1b", repo: { full_name: repository } },
} };
const env = {
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REPOSITORY: repository,
  GITHUB_SHA: "b".repeat(40),
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2",
  DELIVERY_DEPLOYMENT_ID: "dpl_fixture",
};
const binding = appPreviewEvent(event, env);

describe("dedicated application Preview", () => {
  it.each([
    [417, "codex/pr365-menu-search", "staging", "d59f693fa4d6273f30b3bb8de08ad28f7cb4dddc", "codex/pr365-menu-search"],
    [423, "staging", "main", "0079effa188847f2d3c832c8413e59b82ba5689c", "codex/pr423-menu-search-preview"],
    [421, "codex/recovery-loader-fix", "staging", "e94890556e37dc0afbaffcacb0a1176ad26213af", "codex/recovery-loader-fix"],
    [422, "staging", "main", "bdd968cf3fceb6d392e003e32d8f602f633f7541", "codex/pr422-recovery-preview"],
  ])("binds PR %i to its source and isolated branch", (number, head, base, sha, gitBranch) => {
    const input = structuredClone(event);
    input.pull_request.number = number;
    input.pull_request.head.ref = head;
    Object.assign(input.pull_request.base, { ref: base, sha });
    expect(appPreviewEvent(input, env)).toMatchObject({ gitBranch, resource: `pr-${number}-app-123-2` });
    input.pull_request.base.sha = "c".repeat(40);
    expect(() => appPreviewEvent(input, env)).toThrow();
  });

  it.each([
    [433, "codex/webprnt-claim-20261128", "staging", "63557efdc7523a296e760f931fe97b29326892ff", "codex/webprnt-claim-20261128"],
    [434, "staging", "main", "dc752e718a1a04c096637c8d39757aa8eb062bfa", "codex/webprnt-claim-promotion-20261128"],
  ])("requires the pinned WebPRNT head and base for PR %i", (number, branch, base, sha, gitBranch) => {
    const candidate = structuredClone(event);
    Object.assign(candidate.pull_request, { number });
    candidate.pull_request.head.ref = branch;
    Object.assign(candidate.pull_request.base, { ref: base, sha });
    const pinned = { ...env, WEBPRNT_CLAIM_PR433_HEAD: headSha, WEBPRNT_CLAIM_PROMOTION_PR: "434", WEBPRNT_CLAIM_PROMOTION_HEAD: headSha };
    expect(appPreviewEvent(candidate, pinned).gitBranch).toBe(gitBranch);
    expect(() => appPreviewEvent(candidate, env)).toThrow();
    candidate.pull_request.base.sha = headSha;
    expect(() => appPreviewEvent(candidate, pinned)).toThrow();
  });

  it("binds the print deferral to the reviewed head and staging baseline", () => {
    const candidate = structuredClone(event);
    candidate.pull_request.number = 425;
    candidate.pull_request.head.ref = "codex/hold-print-424-20261127";
    candidate.pull_request.base.sha = "62f473c9c5779117875668716d7aa75b913eba74";
    const pinned = { ...env, HOLD_PRINT_PR425_HEAD: headSha };
    expect(appPreviewEvent(candidate, pinned).gitBranch).toBe(candidate.pull_request.head.ref);
    expect(() => appPreviewEvent(candidate, env)).toThrow();
    expect(() => appPreviewEvent(candidate, { ...pinned, HOLD_PRINT_PR425_HEAD: env.GITHUB_SHA })).toThrow();
    candidate.pull_request.base.sha = env.GITHUB_SHA;
    expect(() => appPreviewEvent(candidate, pinned)).toThrow();
  });

  it("requires the registered checkout hotfix head, PR, branch and Staging revision", () => {
    const candidate = structuredClone(event);
    candidate.pull_request.number = 429;
    candidate.pull_request.head.ref = "codex/checkout-print-hotfix-20261127";
    candidate.pull_request.base.sha = "434e798642b1d6c56a55e7bfae4c1e31f0490a98";
    const registered = { ...env, CHECKOUT_PRINT_PR429_HEAD: headSha };
    expect(appPreviewEvent(candidate, registered).gitBranch).toBe(candidate.pull_request.head.ref);
    expect(() => appPreviewEvent(candidate, env)).toThrow();
    for (const alter of [
      pr => { pr.number++; },
      pr => { pr.head.ref = "staging"; },
      pr => { pr.head.sha = env.GITHUB_SHA; },
      pr => { pr.base.ref = "main"; },
      pr => { pr.base.sha = env.GITHUB_SHA; },
    ]) {
      const wrong = structuredClone(candidate);
      alter(wrong.pull_request);
      expect(() => appPreviewEvent(wrong, registered)).toThrow();
    }
  });

  it("requires the separately registered web application PR, revision and base", () => {
    const candidate = structuredClone(event);
    Object.assign(candidate.pull_request, { number: 426 });
    candidate.pull_request.head.ref = "codex/web-shared-contracts-20261127";
    const registered = { ...env, WEB_APPLICATIONS_PR426_HEAD: headSha, WEB_APPLICATIONS_PR426_BASE: candidate.pull_request.base.sha };
    expect(appPreviewEvent(candidate, registered).gitBranch).toBe(candidate.pull_request.head.ref);
    expect(() => appPreviewEvent(candidate, env)).toThrow();
    expect(() => appPreviewEvent(candidate, { ...registered, WEB_APPLICATIONS_PR426_BASE: headSha })).toThrow();
    const promotion = structuredClone(candidate);
    Object.assign(promotion.pull_request, { number: 428 });
    promotion.pull_request.head.ref = "staging";
    Object.assign(promotion.pull_request.base, { ref: "main", sha: "750d205f9a9338bdb3c04dedc2fdbd3272862359" });
    const pinned = { ...env, WEB_APPLICATIONS_PROMOTION_PR: "428", WEB_APPLICATIONS_PROMOTION_HEAD: headSha };
    expect(appPreviewEvent(promotion, pinned).gitBranch).toBe("codex/pr428-web-applications-preview");
    expect(() => appPreviewEvent(promotion, { ...pinned, WEB_APPLICATIONS_PROMOTION_PR: "429" })).toThrow();
    expect(() => appPreviewEvent(promotion, { ...pinned, WEB_APPLICATIONS_PROMOTION_HEAD: env.GITHUB_SHA })).toThrow();
  });

  it("admits only the pinned integration PR and exact base", () => {
    expect(binding.resource).toBe("pr-413-app-123-2");
    for (const field of ["number", "base", "head"]) {
      const candidate = structuredClone(event);
      if (field === "number") candidate.pull_request.number = 414;
      else candidate.pull_request[field].sha = "c".repeat(40);
      if (field === "head") candidate.pull_request.head.repo.full_name = "other/repository";
      expect(() => appPreviewEvent(candidate, env)).toThrow();
    }
    expect(() => appPreviewEvent(event, { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" })).toThrow();
  });

  it("keeps the promotion source and Supabase Git binding distinct", () => {
    const promotion = structuredClone(event);
    Object.assign(promotion.pull_request, { number: 414 });
    Object.assign(promotion.pull_request.head, { ref: "staging" });
    Object.assign(promotion.pull_request.base, { ref: "main", sha: "bf42bdfb10974d8fe57ef3509d2d3dd4d7cef4fa" });
    const expected = appPreviewEvent(promotion, env);
    expect(expected).toMatchObject({ branch: "staging", gitBranch: "codex/preview-pr-414-20261123", resource: "pr-414-app-123-2" });
    const repair = structuredClone(promotion);
    repair.pull_request.number = 415;
    repair.pull_request.head.ref = "codex/app-release-recovery-20261123";
    Object.assign(repair.pull_request.base, { ref: "staging", sha: "6c7c0524c4e75b2dc06295e2f90303fee4a629f2" });
    expect(appPreviewEvent(repair, env)).toMatchObject({ gitBranch: repair.pull_request.head.ref, resource: "pr-415-app-123-2" });
    promotion.pull_request.number = 416;
    expect(() => appPreviewEvent(promotion, env)).toThrow();
  });

  it("rejects Primary, borrowed branches, and branches with copied data", () => {
    const branch = {
      name: binding.resource, project_ref: "c".repeat(20),
      id: "7beb0bc1-0bd5-42c1-9f73-83cb10517d83", parent_project_ref: "eyuctbnlvnbnivwasvqr",
      git_branch: binding.branch, is_default: false, with_data: false, persistent: false,
    };
    expect(ownedBranch([branch], binding)).toEqual(branch);
    expect(ownedBranch([{ ...branch, name: "pr-389-oauth-delivery" }], binding)).toBeNull();
    expect(() => ownedBranch([branch, branch], binding)).toThrow();
    for (const alternative of [{ git_branch: "staging" }, { with_data: true }, { is_default: true }, { persistent: true },
      { project_ref: "eyuctbnlvnbnivwasvqr" }, { project_ref: "teunnvfakbfzmodajqjz" }]) {
      expect(() => ownedBranch([{ ...branch, ...alternative }], binding)).toThrow();
    }
  });

  it("binds the deployment to the expected owner, source and run before smoke or cleanup", () => {
    const deployment = {
      id: env.DELIVERY_DEPLOYMENT_ID, projectId: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP",
      ownerId: "team_MMfsiG94K9Zy3e6w7Ccc9xY4", target: null,
      url: "stallorder-platform-fixture-ada76145-8663s-projects.vercel.app",
      meta: { githubCommitRef: binding.branch, githubCommitSha: env.GITHUB_SHA,
        stallorderPreviewRun: env.GITHUB_RUN_ID, stallorderPreviewResource: binding.resource },
    };
    expect(appDeployment(deployment, binding, env)).toBe("https://" + deployment.url);
    expect(() => appDeployment({ ...deployment, target: "production" }, binding, env)).toThrow();
    expect(() => appDeployment({ ...deployment, ownerId: "team_other" }, binding, env)).toThrow();
    expect(() => appDeployment({ ...deployment, meta: { ...deployment.meta,
      stallorderPreviewResource: "pr-389" } }, binding, env)).toThrow();
  });
});
