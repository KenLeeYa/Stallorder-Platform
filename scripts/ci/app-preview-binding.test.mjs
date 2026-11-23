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

  it("rejects Primary, borrowed branches, and branches with copied data", () => {
    const branch = {
      name: binding.resource, project_ref: "c".repeat(20),
      id: "7beb0bc1-0bd5-42c1-9f73-83cb10517d83", parent_project_ref: "eyuctbnlvnbnivwasvqr",
      git_branch: binding.branch, is_default: false, with_data: false, persistent: false,
    };
    expect(ownedBranch([branch], binding)).toEqual(branch);
    expect(ownedBranch([{ ...branch, name: "pr-389-oauth-delivery" }], binding)).toBeNull();
    expect(() => ownedBranch([branch, branch], binding)).toThrow();
    for (const alternative of [{ with_data: true }, { is_default: true }, { persistent: true },
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
