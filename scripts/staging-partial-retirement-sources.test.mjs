import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readCurrentPartialSources } from "./staging-partial-retirement-sources.mjs";

vi.mock("node:child_process", async original => ({ ...await original(), execFileSync: vi.fn() }));
const main = "a".repeat(40), staging = "b".repeat(40), tree = "c".repeat(40);
const repo = "KenLeeYa/Stallorder-Platform";
const prefix = `/repos/${repo}`;
const workflows = ["ci.yml", "codeql.yml", "production-readiness.yml"];
const passed = ["Require verified Staging tree for Production", "Validate protected environment configuration",
  "Export temporary database access", "Compare migration history", "Audit global stall codes before planning or applying schema",
  "Detect pending or divergent migrations", "Lint remote database before apply", "Create immutable Production plan receipt",
  "Upload Production release plan"];
const skipped = ["Validate protected Production configuration", "Normalize protected Vercel token",
  "Install locked dependencies for protected runtime-secret export", "Export active public-order runtime secrets",
  "Install pinned Vercel CLI", "Build approved Production deployment without assigning domains", "Apply pending migrations",
  "Apply reviewed out-of-order migrations", "Verify applied migration history", "Lint remote database after apply",
  "Re-audit global stall codes after apply", "Backfill legacy availability deadlines on the verified Primary writer",
  "Deploy Production Edge Functions", "Verify deployed Production Edge Functions", "Promote approved deployment and smoke Production",
  "Create immutable successful Production migration evidence", "Upload successful Production migration evidence"];
const times = { started_at: "2026-10-23T10:00:00Z", completed_at: "2026-10-23T10:01:00Z" };
function fixture() {
  const records = new Map();
  for (const [branch, sha, offset] of [["main", main, 0], ["staging", staging, 3]]) {
    records.set(`${prefix}/git/ref/heads/${branch}`, { ref: `refs/heads/${branch}`, object: { type: "commit", sha } });
    records.set(`${prefix}/git/commits/${sha}`, { sha, tree: { sha: tree }, message: "private commit text" });
    const runs = workflows.map((path, i) => ({ id: offset + i + 1, run_attempt: 1, head_sha: sha,
      head_branch: branch, path: `.github/workflows/${path}`, status: "completed", conclusion: "success", event: "push",
      repository: { full_name: repo, owner: { login: "KenLeeYa" } }, head_repository: { full_name: repo },
      display_title: "private title" }));
    records.set(`${prefix}/actions/runs?head_sha=${sha}&event=push&per_page=100`, { total_count: 3, workflow_runs: runs });
    for (const run of runs) records.set(`${prefix}/actions/runs/${run.id}`, run);
  }
  const jobs = ["verify-local", "verify-remote"].map((name, i) => ({ id: 11 + i, name, run_id: 3, run_attempt: 1,
    head_sha: main, status: "completed", conclusion: "success", ...times, steps: name === "verify-local" ? []
      : [...passed, ...skipped].map((name, j) => ({ name, number: j + 1, status: "completed",
        conclusion: j < passed.length ? "success" : "skipped", ...times })) }));
  records.set(`${prefix}/actions/runs/3/attempts/1/jobs?per_page=100`, { total_count: 2, jobs });
  return records;
}
function serve(records, override) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    const parsed = new URL(url), key = parsed.pathname + parsed.search;
    expect(parsed.origin).toBe("https://api.github.com");
    expect(options.method ?? "GET").toBe("GET"); expect(options.body).toBeUndefined(); expect(options.redirect).toBe("error");
    calls.push(key);
    const response = override?.(key, calls); if (response) return response;
    if (!records.has(key)) throw new Error("unexpected endpoint");
    return Response.json(records.get(key));
  }));
  return calls;
}
describe("current partial-proof source observation", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_SHA", main); vi.stubEnv("GITHUB_TOKEN", "fixture-token");
    vi.mocked(execFileSync).mockImplementation((_file, args) => args[1] === "origin/staging" ? staging : main);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("binds current equal-tree refs and six push receipts to actually executed main remote checks, never Plan qualification", async () => {
    vi.stubEnv("DR_BACKUP_ENCRYPTION_KEY", "private backup key must not reach git");
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "private provider token must not reach git");
    const calls = serve(fixture());
    const report = await readCurrentPartialSources();
    expect(report).toMatchObject({ diagnosticOnly: true, planQualified: false, sourceSha: main,
      stagingSha: staging, tree, currentSourcesMatched: true, mainRemoteReadinessPassed: true,
      stagingRemoteReadinessClaimed: false });
    expect(report.checks).toHaveLength(6);
    expect(report.remoteReadiness).toEqual({ runId: 3, attempt: 1, jobId: 12, executedChecks: 9, skippedMutationSteps: 17 });
    expect(JSON.stringify(report)).not.toMatch(/private|fixture-token/);
    for (const [, , options] of vi.mocked(execFileSync).mock.calls) {
      expect(Object.keys(options.env).every(key => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase()))).toBe(true);
      expect(JSON.stringify(options.env)).not.toMatch(/private|fixture-token/);
    }
    for (const sha of [main, staging]) expect(calls).toContain(`${prefix}/actions/runs?head_sha=${sha}&event=push&per_page=100`);
  });

  it("rejects malformed source, stale checkout/ref, unequal tree and mid-read ref drift", async () => {
    serve(fixture()); vi.stubEnv("GITHUB_SHA", "private malformed sha");
    await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
    expect(fetch).not.toHaveBeenCalled(); vi.stubEnv("GITHUB_SHA", main);
    vi.mocked(execFileSync).mockReturnValue(staging);
    await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(execFileSync).mockImplementation((_file, args) => args[1] === "origin/staging" ? staging : main);
    for (const mutate of [
      r => { r.get(`${prefix}/git/ref/heads/main`).object.sha = staging; },
      r => { r.get(`${prefix}/git/ref/heads/staging`).object.type = "tag"; },
      r => { r.get(`${prefix}/git/ref/heads/staging`).ref = "refs/heads/other"; },
      r => { r.get(`${prefix}/git/commits/${staging}`).tree.sha = "d".repeat(40); },
      r => { r.get(`${prefix}/git/commits/${staging}`).sha = main; },
    ]) {
      const records = fixture(); mutate(records); serve(records);
      await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
    }
    serve(fixture(), (key, calls) => key === `${prefix}/git/ref/heads/staging` && calls.filter(x => x === key).length > 1
      ? Response.json({ ref: "refs/heads/staging", object: { type: "commit", sha: "d".repeat(40) } }) : null);
    await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
  });

  it("does not replace the original first-match/six-gate predicates with old successful badges", async () => {
    for (const mutate of [
      r => { const list = r.get(`${prefix}/actions/runs?head_sha=${main}&event=push&per_page=100`);
        list.workflow_runs.unshift({ ...list.workflow_runs[0], conclusion: "failure" }); list.total_count = 4; },
      r => { r.get(`${prefix}/actions/runs?head_sha=${staging}&event=push&per_page=100`).total_count = 100; },
      r => { r.get(`${prefix}/actions/runs?head_sha=${staging}&event=push&per_page=100`).workflow_runs.pop(); },
      r => { r.get(`${prefix}/actions/runs/1`).head_branch = "staging"; },
      r => { r.get(`${prefix}/actions/runs/1`).event = "pull_request"; },
      r => { r.get(`${prefix}/actions/runs/1`).repository.owner.login = "other"; },
      r => { r.get(`${prefix}/actions/runs/1`).head_repository.full_name = "other/fork"; },
      r => { r.get(`${prefix}/actions/runs/1`).id = "private id"; },
      r => { r.get(`${prefix}/actions/runs/1`).run_attempt = 0; },
      r => { r.get(`${prefix}/actions/runs/6`).conclusion = "cancelled"; },
    ]) {
      const records = fixture(); mutate(records); serve(records);
      await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
    }
    // A direct latest-run read must still agree with the attempt chosen by the original list.
    serve(fixture(), key => key === `${prefix}/actions/runs/3`
      ? Response.json({ ...fixture().get(key), run_attempt: 2 }) : null);
    await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
  });

  it("rejects skipped/missing/duplicate/wrong-attempt remote evidence and any executed Production mutation step", async () => {
    const path = `${prefix}/actions/runs/3/attempts/1/jobs?per_page=100`;
    for (const mutate of [
      j => { j.total_count = 3; }, j => { j.total_count = 100; },
      j => { j.jobs[0].conclusion = "skipped"; }, j => { j.jobs[1].conclusion = "skipped"; },
      j => { j.jobs[1].head_sha = staging; }, j => { j.jobs[1].run_attempt = 2; }, j => { j.jobs[1].run_id = 6; },
      j => { j.jobs[1].name = "verify-local"; }, j => { j.jobs[1].id = null; },
      j => { j.jobs[1].steps[0].conclusion = "skipped"; }, j => { j.jobs[1].steps.splice(3, 1); },
      j => { j.jobs[1].steps[0].completed_at = null; }, j => { j.jobs[1].steps[0].started_at = null; },
      j => { j.jobs[1].steps[0].completed_at = "2026-10-23T10:02:00Z"; },
      j => { j.jobs[1].steps[1].number = 1; }, j => { j.jobs[1].steps.push({ ...j.jobs[1].steps[0], number: 88 }); },
      j => { j.jobs[1].steps.find(s => s.name === "Apply pending migrations").conclusion = "success"; },
      j => { j.jobs[1].steps.find(s => s.name === "Deploy Production Edge Functions").conclusion = "success"; },
      j => { j.jobs[1].steps.find(s => s.name === "Promote approved deployment and smoke Production").conclusion = "success"; },
    ]) {
      const records = fixture(); mutate(records.get(path)); serve(records);
      await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
    }
    serve(fixture(), (key, calls) => key === `${prefix}/actions/runs/3` && calls.filter(x => x === key).length > 1
      ? Response.json({ ...fixture().get(key), run_attempt: 2 }) : null);
    await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
  });

  it("makes no retry or write on provider errors and never returns private response/command content", async () => {
    for (const status of [401, 403, 429, 500]) {
      const calls = serve(fixture(), key => key === `${prefix}/git/commits/${main}`
        ? new Response("private provider body", { status }) : null);
      await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
      expect(calls.filter(x => x === `${prefix}/git/commits/${main}`)).toHaveLength(1);
    }
    serve(fixture()); vi.mocked(execFileSync).mockImplementation(() => { throw new Error("private command output"); });
    await expect(readCurrentPartialSources()).rejects.toThrow(/^STAGING_PARTIAL_SOURCES_INVALID$/);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/private|fixture-token/);
  });
});
