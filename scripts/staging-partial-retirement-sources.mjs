// Current read-only source evidence, not an invocation guard or a new Plan.
import { execFileSync } from "node:child_process";
import { conversionApi, conversionRequired, verifyConversionSourceChecks } from "./dr-staging-conversion-plan.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const prefix = `/repos/${repository}`;
const workflows = ["ci.yml", "codeql.yml", "production-readiness.yml"];
const executedChecks = ["Require verified Staging tree for Production", "Validate protected environment configuration",
  "Export temporary database access", "Compare migration history", "Audit global stall codes before planning or applying schema",
  "Detect pending or divergent migrations", "Lint remote database before apply", "Create immutable Production plan receipt",
  "Upload Production release plan"];
const mutationSteps = ["Validate protected Production configuration", "Normalize protected Vercel token",
  "Install locked dependencies for protected runtime-secret export", "Export active public-order runtime secrets",
  "Install pinned Vercel CLI", "Build approved Production deployment without assigning domains", "Apply pending migrations",
  "Apply reviewed out-of-order migrations", "Verify applied migration history", "Lint remote database after apply",
  "Re-audit global stall codes after apply", "Backfill legacy availability deadlines on the verified Primary writer",
  "Deploy Production Edge Functions", "Verify deployed Production Edge Functions", "Promote approved deployment and smoke Production",
  "Create immutable successful Production migration evidence", "Upload successful Production migration evidence"];
const shaValid = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const idValid = value => Number.isSafeInteger(value) && value > 0;
function requireSource(condition) { if (!condition) throw new Error("STAGING_PARTIAL_SOURCES_INVALID"); }
const get = path => conversionApi("github", `${prefix}${path}`, { method: "GET" });
async function readRef(branch) {
  const ref = await get(`/git/ref/heads/${branch}`);
  requireSource(ref?.ref === `refs/heads/${branch}` && ref.object?.type === "commit" && shaValid(ref.object.sha));
  return ref.object.sha;
}
function checkRun(run, check, branch) {
  requireSource(run?.id === check.runId && run.run_attempt === check.attempt && run.head_sha === check.sha
    && run.head_branch === branch && run.path === `.github/workflows/${check.workflow}` && run.event === "push"
    && run.status === "completed" && run.conclusion === "success" && run.repository?.full_name === repository
    && run.repository.owner?.login === "KenLeeYa" && run.head_repository?.full_name === repository);
}
function checkJob(job, check) {
  requireSource(idValid(job?.id) && job.run_id === check.runId && job.run_attempt === check.attempt
    && job.head_sha === check.sha && job.status === "completed" && job.conclusion === "success"
    && Number.isFinite(Date.parse(job.started_at)) && Date.parse(job.completed_at) >= Date.parse(job.started_at));
}

export async function readCurrentPartialSources() {
  try {
    const sourceSha = conversionRequired("GITHUB_SHA");
    requireSource(shaValid(sourceSha));
    requireSource(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase()))) }).trim() === sourceSha);
    const [main, staging] = await Promise.all([readRef("main"), readRef("staging")]);
    requireSource(main === sourceSha && main !== staging);
    const commits = await Promise.all([main, staging].map(sha => get(`/git/commits/${sha}`)));
    for (const [i, sha] of [main, staging].entries()) requireSource(commits[i]?.sha === sha && shaValid(commits[i]?.tree?.sha));
    requireSource(commits[0].tree.sha === commits[1].tree.sha);
    // Reuse the unchanged query, first-match selection, page count and predicates.
    // Independent exact-run reads below bind branch/attempt identity as well.
    const checks = await verifyConversionSourceChecks();
    requireSource(checks.length === 6 && new Set(checks.map(c => c.runId)).size === 6);
    for (const [branch, sha] of [["main", main], ["staging", staging]]) {
      for (const workflow of workflows) {
        const matches = checks.filter(c => c.sha === sha && c.workflow === workflow);
        requireSource(matches.length === 1 && idValid(matches[0].runId) && idValid(matches[0].attempt));
        checkRun(await get(`/actions/runs/${matches[0].runId}`), matches[0], branch);
      }
    }
    const remote = checks.find(c => c.sha === main && c.workflow === "production-readiness.yml");
    const jobs = await get(`/actions/runs/${remote.runId}/attempts/${remote.attempt}/jobs?per_page=100`);
    requireSource(Number.isSafeInteger(jobs?.total_count) && jobs.total_count > 0 && jobs.total_count < 100
      && Array.isArray(jobs.jobs) && jobs.jobs.length === jobs.total_count
      && new Set(jobs.jobs.map(j => j.id)).size === jobs.jobs.length);
    for (const name of ["verify-local", "verify-remote"]) {
      const matches = jobs.jobs.filter(j => j.name === name); requireSource(matches.length === 1); checkJob(matches[0], remote);
    }
    const job = jobs.jobs.find(j => j.name === "verify-remote");
    requireSource(Array.isArray(job.steps) && new Set(job.steps.map(s => s.name)).size === job.steps.length
      && job.steps.every(s => idValid(s.number)) && new Set(job.steps.map(s => s.number)).size === job.steps.length);
    for (const [names, conclusion] of [[executedChecks, "success"], [mutationSteps, "skipped"]]) {
      for (const name of names) {
        const step = job.steps.find(s => s.name === name);
        requireSource(step?.status === "completed" && step.conclusion === conclusion);
        if (conclusion === "success") requireSource(Number.isFinite(Date.parse(step.started_at))
          && Date.parse(step.started_at) >= Date.parse(job.started_at)
          && Date.parse(step.completed_at) >= Date.parse(step.started_at)
          && Date.parse(step.completed_at) <= Date.parse(job.completed_at));
      }
    }
    // A new rerun or a moved ref invalidates the just-read observation. This is
    // bounded readback, not a lock on future source changes or provider state.
    checkRun(await get(`/actions/runs/${remote.runId}`), remote, "main");
    const after = await Promise.all([readRef("main"), readRef("staging")]);
    requireSource(after[0] === main && after[1] === staging);
    return { diagnosticOnly: true, planQualified: false, sourceSha, stagingSha: staging, tree: commits[0].tree.sha,
      currentSourcesMatched: true, mainRemoteReadinessPassed: true, stagingRemoteReadinessClaimed: false, checks,
      remoteReadiness: { runId: remote.runId, attempt: remote.attempt, jobId: job.id,
        executedChecks: executedChecks.length, skippedMutationSteps: mutationSteps.length } };
  } catch {
    // No untrusted GitHub fields, raw command output or credentials in failures.
    throw new Error("STAGING_PARTIAL_SOURCES_INVALID");
  }
}
