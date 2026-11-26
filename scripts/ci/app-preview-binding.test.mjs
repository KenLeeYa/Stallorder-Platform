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
  it("admits only the registered weekly PR head on its reviewed staging base", () => {
    const weekly = structuredClone(event);
    weekly.pull_request.number = 420;
    weekly.pull_request.head.ref = "codex/qidaigo-intake-20261123";
    weekly.pull_request.base.sha = "62f473c9c5779117875668716d7aa75b913eba74";
    const approved = { ...env, WEEKLY_PREVIEW_PR420_HEAD: headSha };
    expect(appPreviewEvent(weekly, approved)).toMatchObject({
      gitBranch: "codex/qidaigo-intake-20261123", resource: "pr-420-app-123-2",
    });
    expect(() => appPreviewEvent(weekly, env)).toThrow();
    expect(() => appPreviewEvent(weekly, { ...approved, WEEKLY_PREVIEW_PR420_HEAD: "c".repeat(40) })).toThrow();
    for (const [side, key, value] of [
      ["head", "ref", "codex/unregistered"], ["base", "ref", "main"],
      ["base", "sha", "c".repeat(40)], ["head", "repo", { full_name: "other/repository" }],
    ]) {
      const changed = structuredClone(weekly);
      changed.pull_request[side][key] = value;
      expect(() => appPreviewEvent(changed, approved)).toThrow();
    }
  });

  it.each([
    [424, "codex/checkout-print-latency", "staging", "fea99277da62c9a635197bf2353ccda9f36856a8", "codex/checkout-print-latency"],
    [425, "staging", "main", "750d205f9a9338bdb3c04dedc2fdbd3272862359", "codex/pr425-print-preview"],
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
