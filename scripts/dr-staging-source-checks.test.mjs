import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { verifyConversionSourceChecks, diagnoseConversionSourceChecks } from "./dr-staging-conversion-plan.mjs";

vi.mock("node:child_process", async (original) => ({ ...await original(), execFileSync: vi.fn() }));
const main = "a".repeat(40);
const staging = "b".repeat(40);
const paths = ["ci.yml", "codeql.yml", "production-readiness.yml"];
const runsFor = (sha) => paths.map((path, index) => ({
  path: `.github/workflows/${path}`, head_sha: sha, status: "completed", conclusion: "success",
  id: index + 1, run_attempt: 1,
}));
let output;
let request;

beforeEach(() => {
  vi.stubEnv("GITHUB_SHA", main);
  vi.stubEnv("GITHUB_TOKEN", "fixture-not-a-real-token");
  vi.mocked(execFileSync).mockReturnValue(`${staging}\n`);
  output = vi.spyOn(console, "error").mockImplementation(() => {});
  request = vi.fn(async (url) => {
    const sha = new URL(url).searchParams.get("head_sha");
    return new Response(JSON.stringify({ total_count: 3, workflow_runs: runsFor(sha) }));
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("conversion source gate diagnostics at the actual fetch boundary", () => {
  it.each([
    ["missing_workflow", null, { found: false, shaMatches: false, completed: false, successful: false }],
    ["sha_mismatch", { head_sha: staging }, { found: true, shaMatches: false, completed: true, successful: true }],
    ["not_completed", { status: "in_progress" }, { found: true, shaMatches: true, completed: false, successful: true }],
    ["not_successful", { conclusion: "failure" }, { found: true, shaMatches: true, completed: true, successful: false }],
  ])("identifies %s without accepting it or leaking arbitrary API fields", async (_name, change, predicates) => {
    const runs = change === null ? [] : [{ ...runsFor(main)[0], ...change,
      display_title: "private-sentinel", html_url: "https://private.invalid/?token=private-sentinel" }];
    request.mockResolvedValue(new Response(JSON.stringify({ total_count: runs.length, workflow_runs: runs })));
    await expect(verifyConversionSourceChecks()).rejects.toThrow("STAGING_SOURCE_CHECKS_NOT_PASSED");
    expect(request).toHaveBeenCalledTimes(1);
    const rows = output.mock.calls.map(([line]) => JSON.parse(line));
    expect(rows).toContainEqual(expect.objectContaining({ event: "staging-source-check", sha: main,
      workflow: "ci.yml", totalCount: runs.length, returnedCount: runs.length, ...predicates }));
    expect(JSON.stringify(rows)).not.toMatch(/private-sentinel|fixture-not-a-real-token/);
  });

  it("keeps the exact original query, first-match selection and six successful receipts", async () => {
    const result = await verifyConversionSourceChecks();
    expect(result).toHaveLength(6);
    expect(request.mock.calls.map(([url]) => url)).toEqual([main, staging].map((sha) =>
      `https://api.github.com/repos/KenLeeYa/Stallorder-Platform/actions/runs?head_sha=${sha}&event=push&per_page=100`));
    for (const [, options] of request.mock.calls) {
      expect(options.method ?? "GET").toBe("GET");
      expect(options.redirect).toBe("error");
    }
    const runs = [{ ...runsFor(main)[0], conclusion: "failure" }, ...runsFor(main)];
    request.mockReset().mockResolvedValue(new Response(JSON.stringify({ total_count: 4, workflow_runs: runs })));
    await expect(verifyConversionSourceChecks()).rejects.toThrow("STAGING_SOURCE_CHECKS_NOT_PASSED");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("identifies the second SHA and final required workflow", async () => {
    request.mockImplementation(async (url) => {
      const sha = new URL(url).searchParams.get("head_sha");
      const runs = runsFor(sha).slice(0, sha === staging ? 2 : 3);
      return new Response(JSON.stringify({ total_count: runs.length, workflow_runs: runs }));
    });
    await expect(verifyConversionSourceChecks()).rejects.toThrow("STAGING_SOURCE_CHECKS_NOT_PASSED");
    expect(output.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual(expect.objectContaining({
      event: "staging-source-check", sha: staging, workflow: "production-readiness.yml", found: false,
    }));
  });

  it("still rejects a full page and HTTP errors without retries", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ total_count: 100, workflow_runs: runsFor(main) })));
    await expect(verifyConversionSourceChecks()).rejects.toThrow("STAGING_SOURCE_CHECKS_AMBIGUOUS");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockReset().mockResolvedValue(new Response("private-sentinel", { status: 403 }));
    await expect(verifyConversionSourceChecks()).rejects.toThrow("STAGING_GITHUB_HTTP_403");
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain("private-sentinel");
  });

  it("redacts malformed run fields while preserving the failing predicate", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ total_count: 1, workflow_runs: [{
      ...runsFor(main)[0], head_sha: "private-sentinel", id: "private-sentinel", run_attempt: "private-sentinel",
    }] })));
    await expect(verifyConversionSourceChecks()).rejects.toThrow("STAGING_SOURCE_CHECKS_NOT_PASSED");
    expect(JSON.stringify(output.mock.calls)).not.toContain("private-sentinel");
  });
});

describe("protected source-only diagnostic entry", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("GITHUB_REPOSITORY", "KenLeeYa/Stallorder-Platform");
    vi.stubEnv("GITHUB_ACTOR", "KenLeeYa");
    vi.stubEnv("GITHUB_REF", "refs/heads/main");
    vi.stubEnv("DIAGNOSTIC_MAIN_SHA", main);
    vi.stubEnv("DIAGNOSTIC_STAGING_SHA", staging);
  });

  it.each([
    ["GITHUB_ACTIONS", "false"], ["GITHUB_REPOSITORY", "other/repository"],
    ["GITHUB_ACTOR", "other-actor"], ["GITHUB_REF", "refs/heads/staging"],
  ])("rejects invalid %s before reading GitHub", async (key, value) => {
    vi.stubEnv(key, value);
    await expect(diagnoseConversionSourceChecks()).rejects.toThrow("STAGING_INVOCATION_INVALID");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects invalid commit syntax and mismatched trees before any request", async () => {
    vi.stubEnv("DIAGNOSTIC_MAIN_SHA", "main; private-sentinel");
    await expect(diagnoseConversionSourceChecks()).rejects.toThrow("STAGING_DIAGNOSTIC_SOURCE_INVALID");
    expect(request).not.toHaveBeenCalled();
    vi.stubEnv("DIAGNOSTIC_MAIN_SHA", main);
    vi.mocked(execFileSync).mockReturnValueOnce("tree-one").mockReturnValueOnce("tree-two");
    await expect(diagnoseConversionSourceChecks()).rejects.toThrow("STAGING_DIAGNOSTIC_TREE_MISMATCH");
    expect(request).not.toHaveBeenCalled();
  });

  it("runs the actual CLI without backup/provider secrets or a Plan/GITHUB_ENV write", async () => {
    const { execFileSync: realExec, spawnSync } = await vi.importActual("node:child_process");
    const sha = realExec("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const fixture = `globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.github.com/repos/KenLeeYa/Stallorder-Platform/actions/runs?head_sha=${sha}&event=push&per_page=100'
        || (options.method ?? 'GET') !== 'GET') throw Error('unexpected request');
      return new Response(JSON.stringify({total_count:3,workflow_runs:${JSON.stringify(runsFor(sha))}}));
    };`;
    const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(fixture)}`,
      "scripts/dr-staging-conversion-plan.mjs", "diagnose-sources"], { encoding: "utf8", env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "KenLeeYa/Stallorder-Platform", GITHUB_ACTOR: "KenLeeYa",
      GITHUB_REF: "refs/heads/main", GITHUB_TOKEN: "fixture-not-a-real-token", GITHUB_SHA: sha,
      DIAGNOSTIC_MAIN_SHA: sha, DIAGNOSTIC_STAGING_SHA: sha,
    } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ diagnosticOnly: true, planQualified: false });
    expect(result.stderr).not.toMatch(/fixture-not-a-real-token|BACKUP|PROVIDER/);
  });
});
