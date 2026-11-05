// Fixed GET-only transport shared by current and explicit historical diagnostics.
import { createHash } from "node:crypto";
import { conversionRequired } from "./dr-staging-conversion-plan.mjs";

const repository = "KenLeeYa/Stallorder-Platform";
const workflow = ".github/workflows/dr-staging-partial-proof.yml";
function requireProof(condition) { if (!condition) throw new Error("STAGING_PARTIAL_READONLY_FAILED"); }

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { method: "GET", redirect: "error",
    headers: { authorization: `Bearer ${conversionRequired("GITHUB_TOKEN")}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(60_000) });
  requireProof(response.status === 200);
  const bytes = await boundedBytes(response, 2 * 1024 * 1024);
  return JSON.parse(bytes.toString("utf8"));
}

async function boundedBytes(response, limit) {
  requireProof(response.body);
  const parts = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length; requireProof(length <= limit); parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

async function archive(runId, artifactId, size, digest) {
  const run = await github(`/actions/runs/${runId}`);
  const artifact = await github(`/actions/artifacts/${artifactId}`);
  let response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`, {
    method: "GET", redirect: "manual", headers: { authorization: `Bearer ${conversionRequired("GITHUB_TOKEN")}` },
    signal: AbortSignal.timeout(60_000) });
  if (response.status === 302) {
    const url = new URL(response.headers.get("location"));
    requireProof(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && (url.hostname.endsWith(".blob.core.windows.net") || url.hostname.endsWith(".actions.githubusercontent.com")));
    // The signed archive URL is private. Never forward the GitHub token, allow
    // another redirect, log this URL, or trust its bytes without pinned hashes.
    response = await fetch(url.href, { method: "GET", redirect: "error", signal: AbortSignal.timeout(60_000) });
  }
  requireProof(response.status === 200);
  const zip = await boundedBytes(response, size); requireProof(zip.length === size);
  requireProof(createHash("sha256").update(zip).digest("hex") === digest);
  return { run, artifact, zip };
}

async function invocation() {
  const env = process.env;
  requireProof(env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === repository
    && env.GITHUB_ACTOR === "KenLeeYa" && env.GITHUB_TRIGGERING_ACTOR === "KenLeeYa"
    && env.GITHUB_REF === "refs/heads/main" && env.GITHUB_REF_PROTECTED === "true"
    && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA
    && env.GITHUB_WORKFLOW_REF === `${repository}/${workflow}@refs/heads/main`
    && env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_RUN_ATTEMPT === "1"
    && /^[1-9][0-9]{0,14}$/.test(env.GITHUB_RUN_ID ?? "")
    && env.GITHUB_JOB === "readonly-proof" && env.RUNNER_OS === "Linux");
  const run = await github(`/actions/runs/${env.GITHUB_RUN_ID}`);
  requireProof(run?.id === Number(env.GITHUB_RUN_ID) && run.run_attempt === 1 && run.head_sha === env.GITHUB_SHA
    && run.head_branch === "main" && run.path === workflow && run.event === "workflow_dispatch"
    && run.status === "in_progress" && run.conclusion === null && run.actor?.login === "KenLeeYa"
    && run.triggering_actor?.login === "KenLeeYa" && run.repository?.full_name === repository
    && run.repository.owner?.login === "KenLeeYa" && run.head_repository?.full_name === repository);
}

export { github as readPartialProofGithub, archive as readPartialProofArchive,
  invocation as assertPartialProofInvocation };
