import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Application-only counterpart of PR366's migration release readback. No provider writes.
const project = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP";
const team = "team_MMfsiG94K9Zy3e6w7Ccc9xY4";
const hostname = "app.qidaigo.com";
const fail = (code) => { throw new Error(code); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export async function readApplicationRuntime(origin, env, request = fetch) {
  if (origin !== `https://${hostname}` && !/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/u.test(origin)) fail("RELEASE_RUNTIME_ORIGIN_INVALID");
  try {
    const get = async (path) => {
      const response = await request(`${origin}${path}`, {
        headers: { accept: "application/json", "cache-control": "no-cache",
          ...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
        redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (response.status !== 200) throw new Error();
      return response;
    };
    const connectivity = await get("/api/connectivity");
    if (await connectivity.text() !== "") throw new Error();
    const version = await get("/api/version"), availability = await get("/api/availability/config");
    if (![version, availability].every(response => response.headers.get("content-type")?.includes("application/json"))) throw new Error();
    const login = await get("/login");
    await login.arrayBuffer();
    return { connectivity: connectivity.headers.get("x-service-state"), loginStatus: login.status,
      version: await version.json(), availability: await availability.json() };
  } catch { fail("RELEASE_RUNTIME_REQUEST_FAILED"); }
}

export function applicationPlanParameters(env) {
  if (!/^dpl_[A-Za-z0-9]+$/u.test(env.RELEASE_HEALTHY_DEPLOYMENT_ID ?? "")
    || !/^[a-f0-9]{40}$/u.test(env.RELEASE_HEALTHY_SHA ?? "")) fail("RELEASE_RECOVERY_TARGET_REQUIRED");
  if (!/^dpl_[A-Za-z0-9]+$/u.test(env.RELEASE_PRIMARY_DEPLOYMENT_ID ?? "")
    || !/^[a-f0-9]{40}$/u.test(env.RELEASE_PRIMARY_SHA ?? "")) fail("RELEASE_PRIMARY_TARGET_REQUIRED");
  if (env.STALLORDER_RESILIENCE_MODE !== "PRIMARY_ONLY") fail("RELEASE_RESILIENCE_MODE_REQUIRED");
  const promotionEpoch = Number(env.RELEASE_PROMOTION_EPOCH);
  if (!Number.isSafeInteger(promotionEpoch) || promotionEpoch < 1) fail("RELEASE_EPOCH_REQUIRED");
  return { databaseChanges: false, edgeFunctionChanges: false, promotionEpoch,
    resilienceMode: env.STALLORDER_RESILIENCE_MODE,
    primaryDeploymentId: env.RELEASE_PRIMARY_DEPLOYMENT_ID, primarySha: env.RELEASE_PRIMARY_SHA,
    recoveryDeploymentId: env.RELEASE_HEALTHY_DEPLOYMENT_ID, recoverySha: env.RELEASE_HEALTHY_SHA };
}

export function assertApplicationPrimary(env) {
  if (env.VERCEL_PROJECT_ID !== project || env.VERCEL_ORG_ID !== team
    || env.APP_BASE_URL !== `https://${hostname}`) fail("RELEASE_PRIMARY_CONFIGURATION_DRIFT");
}

async function ownerState(api) {
  const owner = await api(`/v9/projects/${project}?teamId=${team}`);
  if (owner?.id !== project || owner.accountId !== team) fail("RELEASE_PROJECT_DRIFT");
  return owner;
}

function aliasRequest(owner) {
  // Rolling release activation is not equivalent to a completed full-traffic promotion.
  if (owner.rollingRelease) fail("RELEASE_ROLLING_RELEASE_UNSUPPORTED");
  const request = owner.lastAliasRequest;
  if (request == null) return null;
  const { jobStatus, requestedAt, toDeploymentId, type } = request;
  if (!["pending", "in-progress", "succeeded", "failed", "skipped"].includes(jobStatus)
    || !Number.isSafeInteger(requestedAt) || requestedAt <= 0
    || !/^dpl_[A-Za-z0-9]+$/u.test(toDeploymentId ?? "")
    || !["promote", "rollback"].includes(type)) fail("RELEASE_ALIAS_REQUEST_UNPROVEN");
  return { jobStatus, requestedAt, toDeploymentId, type };
}

function requestPending(request) {
  return ["pending", "in-progress"].includes(request?.jobStatus);
}

// Poll only a positively identified job. A CLI timeout or a stale/missing record
// never proves the remote operation stopped, and never authorizes another write.
export async function settleApplicationPromotion(candidate, expected, api, wait = delay) {
  candidate = structuredClone(candidate);
  expected = { ...expected };
  const observations = [];
  const receipt = (status, reason) => ({ status, reason, safeToRecover: status === "PROMOTION_SETTLED",
    projectId: project, teamId: team,
    deploymentId: /^dpl_[A-Za-z0-9]+$/u.test(candidate?.deploymentId ?? "") ? candidate.deploymentId : null,
    sha: /^[a-f0-9]{40}$/u.test(candidate?.sha ?? "") ? candidate.sha : null,
    observations, checkedAt: new Date().toISOString() });
  try {
    const parameters = applicationPlanParameters(expected);
    if (candidate?.status !== "CANDIDATE_READBACK_VERIFIED" || candidate.projectId !== project || candidate.teamId !== team
      || candidate.sha !== expected.GITHUB_SHA || candidate.resilienceMode !== parameters.resilienceMode
      || !/^dpl_[A-Za-z0-9]+$/u.test(candidate.deploymentId ?? "")
      || [parameters.primaryDeploymentId, parameters.recoveryDeploymentId].includes(candidate.deploymentId)
      || !/^[a-zA-Z0-9-]+\.vercel\.app$/u.test(candidate.url ?? "")
      || `https://${candidate.url}` !== expected.APPROVED_PRODUCTION_DEPLOYMENT
      || !Object.hasOwn(candidate, "aliasRequestBefore")) fail("RELEASE_PROMOTION_BINDING_DRIFT");
    const before = aliasRequest({ lastAliasRequest: candidate.aliasRequestBefore });
    if (requestPending(before)) fail("RELEASE_PROMOTION_BINDING_DRIFT");
    const deployment = await api(`/v13/deployments/${candidate.deploymentId}?teamId=${team}`);
    verifyDeployment(deployment, candidate.sha);
    if (deployment.id !== candidate.deploymentId || deployment.url !== candidate.url) fail("RELEASE_PROMOTION_BINDING_DRIFT");
    let identity;
    for (let attempt = 0; attempt < 12; attempt++) {
      const owner = await ownerState(api);
      const job = aliasRequest(owner);
      if (!job || job.type !== "promote" || job.toDeploymentId !== candidate.deploymentId
        || job.requestedAt <= (before?.requestedAt ?? 0)) fail("RELEASE_PROMOTION_JOB_UNPROVEN");
      const current = `${job.type}:${job.toDeploymentId}:${job.requestedAt}`;
      if (identity && identity !== current) fail("RELEASE_PROMOTION_JOB_CHANGED");
      identity = current;
      observations.push(job);
      if (![parameters.primaryDeploymentId, candidate.deploymentId].includes(owner.targets?.production?.id)) fail("RELEASE_PRIMARY_CHANGED");
      if (!requestPending(job)) return receipt("PROMOTION_SETTLED", null);
      if (attempt < 11) await wait(2000);
    }
    return receipt("PROMOTION_PENDING", "RELEASE_PROMOTION_PENDING");
  } catch (error) {
    return receipt("PROMOTION_UNKNOWN", /^RELEASE_[A-Z_]+$/u.test(error?.message) ? error.message : "RELEASE_PROMOTION_READ_FAILED");
  }
}

function verifyDeployment(deployment, sha) {
  const commits = [deployment?.meta?.githubCommitSha, deployment?.meta?.git_commit].filter((value) => value !== undefined);
  if (!/^dpl_[A-Za-z0-9]+$/u.test(deployment?.id ?? "") || deployment.projectId !== project
    || deployment.target !== "production" || deployment.readyState !== "READY"
    || !/^[a-f0-9]{40}$/u.test(sha ?? "") || !commits.length
    || commits.some((value) => value !== sha)) fail("RELEASE_DEPLOYMENT_DRIFT");
  // Reject the known DR-to-Primary incident even when project, revision and aliases match.
  // Absent/PRIMARY metadata is not proof of the runtime's database/Auth/Edge bindings.
  if (deployment.meta.backend_target === "DR") fail("RELEASE_BACKEND_TARGET_DRIFT");
}

async function aliasesFor(api, id) {
  const response = await api(`/v2/deployments/${encodeURIComponent(id)}/aliases?teamId=${team}`);
  if (!Array.isArray(response?.aliases) || response.pagination?.next
    || response.aliases.some((row) => typeof row?.alias !== "string" || !row.alias)) fail("RELEASE_ALIASES_UNPROVEN");
  const aliases = response.aliases.map((row) => row.alias).sort();
  if (new Set(aliases).size !== aliases.length) fail("RELEASE_ALIASES_UNPROVEN");
  return aliases;
}

async function captureActive(api, deploymentId, sha) {
  const owner = await ownerState(api);
  if (owner.targets?.production?.id !== deploymentId) fail("RELEASE_PRIMARY_CHANGED");
  const deployment = await api(`/v13/deployments/${deploymentId}?teamId=${team}`);
  verifyDeployment(deployment, sha);
  if (deployment.id !== deploymentId) fail("RELEASE_PRIMARY_CHANGED");
  const aliases = await aliasesFor(api, deployment.id);
  if (!aliases.includes(hostname)) fail("RELEASE_PRIMARY_ALIAS_MISSING");
  // Deployment/alias reads can race with another promotion after the initial owner snapshot.
  const latest = await ownerState(api);
  if (latest.targets?.production?.id !== deployment.id) fail("RELEASE_PRIMARY_CHANGED");
  const activeRequest = aliasRequest(latest);
  return { projectId: project, teamId: team, deploymentId: deployment.id, sha,
    aliasRequest: activeRequest, aliases, checkedAt: new Date().toISOString(), status: "BASELINE_READBACK_VERIFIED" };
}

async function verifyRuntime(origin, sha, readRuntime, epoch) {
  if (typeof readRuntime !== "function") fail("RELEASE_RUNTIME_READER_REQUIRED");
  const body = await readRuntime(origin);
  if (body?.connectivity !== "ready" || body.loginStatus !== 200
    || body.version?.revision !== sha || body.availability?.mode !== "NORMAL_PRIMARY"
    || body.availability.activeBackend !== "PRIMARY" || body.availability.promotionEpoch !== epoch) fail("RELEASE_RUNTIME_DRIFT");
  // PRIMARY_ONLY is a release policy bound separately to the verified historical retirement receipt.
  // Public probes prove source, Primary availability and epoch, not authenticated UI acceptance.
  return { resilienceMode: "PRIMARY_ONLY", sourceSha: sha, promotionEpoch: epoch };
}

async function captureRecovery(parameters, baseline, api, readRuntime) {
  const deployment = await api(`/v13/deployments/${parameters.recoveryDeploymentId}?teamId=${team}`);
  verifyDeployment(deployment, parameters.recoverySha);
  if (deployment.id !== parameters.recoveryDeploymentId
    || !/^[a-zA-Z0-9-]+\.vercel\.app$/u.test(deployment.url ?? "")) fail("RELEASE_RECOVERY_DRIFT");
  const aliases = await aliasesFor(api, deployment.id);
  if (deployment.id !== baseline.deploymentId && aliases.some((alias) => baseline.aliases.includes(alias))) fail("RELEASE_RECOVERY_DRIFT");
  const runtime = await verifyRuntime(`https://${deployment.url}`, parameters.recoverySha, readRuntime, parameters.promotionEpoch);
  return { deploymentId: deployment.id, sha: parameters.recoverySha, url: deployment.url, ...runtime };
}

function assertBaseline(baseline, parameters) {
  if (baseline?.deploymentId !== parameters.primaryDeploymentId || baseline.sha !== parameters.primarySha
    || baseline.projectId !== project || baseline.teamId !== team || !Array.isArray(baseline.aliases)
    || !baseline.aliases.includes(hostname) || baseline.recovery?.deploymentId !== parameters.recoveryDeploymentId
    || baseline.recovery.sha !== parameters.recoverySha || baseline.recovery.resilienceMode !== parameters.resilienceMode) fail("RELEASE_BASELINE_DRIFT");
}

export async function captureApplicationBaseline(expected, api, readRuntime) {
  const parameters = applicationPlanParameters(expected);
  const baseline = await captureActive(api, parameters.primaryDeploymentId, parameters.primarySha);
  if (requestPending(baseline.aliasRequest)) fail("RELEASE_PROMOTION_PENDING");
  const recovery = await captureRecovery(parameters, baseline, api, readRuntime);
  await verifyRuntime(`https://${hostname}`, parameters.primarySha, readRuntime, parameters.promotionEpoch);
  const latest = await captureActive(api, parameters.primaryDeploymentId, parameters.primarySha);
  if (!same(latest.aliases, baseline.aliases)) fail("RELEASE_PRIMARY_CHANGED");
  return { ...baseline, recovery };
}

export async function verifyApplicationUnchanged(baseline, expected, api, readRuntime) {
  baseline = structuredClone(baseline);
  const parameters = applicationPlanParameters(expected);
  assertBaseline(baseline, parameters);
  const actual = await captureActive(api, parameters.primaryDeploymentId, parameters.primarySha);
  if (!same(actual.aliases, baseline.aliases)) fail("RELEASE_RECOVERY_DRIFT");
  if (readRuntime) await verifyRuntime(`https://${hostname}`, parameters.primarySha, readRuntime, parameters.promotionEpoch);
  return { ...actual, status: "PRIMARY_UNCHANGED_VERIFIED" };
}

export async function verifyApplicationRecoveryAdmission(baseline, expected, api, readRuntime, admission, verifyConfiguration = async () => {}) {
  baseline = structuredClone(baseline); admission = structuredClone(admission); expected = { ...expected };
  const parameters = applicationPlanParameters(expected);
  assertBaseline(baseline, parameters);
  const admitted = aliasRequest({ lastAliasRequest: admission?.observations?.at(-1) });
  if (admission?.status !== "PROMOTION_SETTLED" || admission.safeToRecover !== true
    || admission.projectId !== project || admission.teamId !== team || admission.sha !== expected.GITHUB_SHA
    || !admitted || requestPending(admitted) || admitted.type !== "promote"
    || admitted.toDeploymentId !== admission.deploymentId
    || [parameters.primaryDeploymentId, parameters.recoveryDeploymentId].includes(admission.deploymentId)) fail("RELEASE_RECOVERY_JOB_UNPROVEN");
  const recheck = async () => {
    const owner = await ownerState(api);
    if (owner.targets?.production?.id !== admission.deploymentId
      || !same(aliasRequest(owner), admitted)) fail("RELEASE_RECOVERY_JOB_UNPROVEN");
    const aliases = await aliasesFor(api, admission.deploymentId);
    const oldAliases = await aliasesFor(api, parameters.primaryDeploymentId);
    const union = [...aliases, ...oldAliases].sort();
    if (new Set(union).size !== union.length || !same(union, baseline.aliases)) fail("RELEASE_RECOVERY_ALIAS_DRIFT");
    const latest = await ownerState(api);
    if (latest.targets?.production?.id !== admission.deploymentId
      || !same(aliasRequest(latest), admitted)) fail("RELEASE_RECOVERY_JOB_UNPROVEN");
  };
  await verifyConfiguration();
  await recheck();
  if (!same(await captureRecovery(parameters, baseline, api, readRuntime), baseline.recovery)) fail("RELEASE_RECOVERY_DRIFT");
  await verifyConfiguration();
  await recheck();
  return { status: "RECOVERY_ADMITTED", deploymentId: parameters.recoveryDeploymentId, sha: parameters.recoverySha };
}

export async function verifyApplicationRecovery(baseline, expected, api, readRuntime, admission) {
  baseline = structuredClone(baseline);
  admission = structuredClone(admission);
  expected = { ...expected };
  const parameters = applicationPlanParameters(expected);
  assertBaseline(baseline, parameters);
  const actual = await captureActive(api, parameters.recoveryDeploymentId, parameters.recoverySha);
  if (!same(actual.aliases, baseline.aliases)) fail("RELEASE_RECOVERY_DRIFT");
  await verifyRuntime(`https://${hostname}`, parameters.recoverySha, readRuntime, parameters.promotionEpoch);
  const latest = await captureActive(api, parameters.recoveryDeploymentId, parameters.recoverySha);
  if (!same(latest.aliases, baseline.aliases)) fail("RELEASE_RECOVERY_DRIFT");
  const owner = await ownerState(api);
  const job = aliasRequest(owner);
  const admittedJob = aliasRequest({ lastAliasRequest: Array.isArray(admission?.observations) ? admission.observations.at(-1) : null });
  if (owner.targets?.production?.id !== parameters.recoveryDeploymentId || job?.jobStatus !== "succeeded"
    || job.type !== "promote" || job.toDeploymentId !== parameters.recoveryDeploymentId
    || admission?.status !== "PROMOTION_SETTLED" || admission.safeToRecover !== true
    || admission.projectId !== project || admission.teamId !== team || admission.sha !== expected.GITHUB_SHA
    || !admittedJob || requestPending(admittedJob) || admittedJob.type !== "promote"
    || admittedJob.toDeploymentId !== admission.deploymentId
    || [parameters.primaryDeploymentId, parameters.recoveryDeploymentId].includes(admission.deploymentId)
    || job.requestedAt <= admittedJob.requestedAt) fail("RELEASE_RECOVERY_JOB_UNPROVEN");
  return { ...actual, aliasRequest: job, status: "RECOVERY_READBACK_VERIFIED" };
}

export async function verifyApplicationTarget(expected, baseline, api, promoted = false, readRuntime) {
  // Keep the requested revision and original alias set stable across awaited reads.
  expected = { ...expected };
  baseline = structuredClone(baseline);
  const parameters = applicationPlanParameters(expected);
  if (!/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/u.test(expected.APPROVED_PRODUCTION_DEPLOYMENT ?? "")) fail("RELEASE_CANDIDATE_URL_INVALID");
  assertBaseline(baseline, parameters);
  const host = new URL(expected.APPROVED_PRODUCTION_DEPLOYMENT).hostname;
  const deployment = await api(`/v13/deployments/${host}?teamId=${team}`);
  verifyDeployment(deployment, expected.GITHUB_SHA);
  if (deployment.url !== host || [baseline.deploymentId, parameters.recoveryDeploymentId].includes(deployment.id)) fail("RELEASE_CANDIDATE_IDENTITY_DRIFT");
  const aliases = await aliasesFor(api, deployment.id);
  if (promoted) {
    const owner = await ownerState(api);
    if (owner.targets?.production?.id !== deployment.id || !same(aliases, baseline.aliases)) fail("RELEASE_PROMOTION_DRIFT");
  } else {
    await verifyApplicationUnchanged(baseline, expected, api);
    const recovery = await captureRecovery(parameters, baseline, api, readRuntime);
    if (!same(recovery, baseline.recovery)) fail("RELEASE_RECOVERY_DRIFT");
    if (aliases.some((alias) => baseline.aliases.includes(alias))) fail("RELEASE_CANDIDATE_ALREADY_ALIASED");
  }
  await verifyRuntime(promoted ? `https://${hostname}` : `https://${host}`, expected.GITHUB_SHA, readRuntime, parameters.promotionEpoch);
  // Recheck ownership/aliases after the authenticated HTTP read, not only before it.
  if (promoted) {
    const active = await captureActive(api, deployment.id, expected.GITHUB_SHA);
    if (!same(active.aliases, baseline.aliases)) fail("RELEASE_PROMOTION_DRIFT");
  } else await verifyApplicationUnchanged(baseline, expected, api);
  const latest = await ownerState(api);
  const aliasRequestBefore = aliasRequest(latest);
  if (requestPending(aliasRequestBefore)) fail("RELEASE_PROMOTION_PENDING");
  if (promoted && (aliasRequestBefore?.jobStatus !== "succeeded" || aliasRequestBefore.type !== "promote"
    || aliasRequestBefore.toDeploymentId !== deployment.id)) fail("RELEASE_PROMOTION_NOT_SUCCEEDED");
  if (latest.targets?.production?.id !== (promoted ? deployment.id : parameters.primaryDeploymentId)) fail("RELEASE_PRIMARY_CHANGED");
  return { projectId: project, teamId: team, deploymentId: deployment.id, sha: expected.GITHUB_SHA,
    ...(!promoted ? { url: deployment.url, aliasRequestBefore } : {}),
    aliases, resilienceMode: parameters.resilienceMode, checkedAt: new Date().toISOString(), status: promoted ? "PROMOTION_READBACK_VERIFIED" : "CANDIDATE_READBACK_VERIFIED" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2];
    const parameters = applicationPlanParameters(process.env);
    if (mode === "parameters") {
      console.log(`PRODUCTION_APPROVAL_PARAMETERS_JSON=${JSON.stringify(parameters)}`);
    } else {
      assertApplicationPrimary(process.env);
      if (!process.env.VERCEL_TOKEN) fail("RELEASE_TOKEN_REQUIRED");
      const api = async (path) => {
        const response = await fetch(`https://api.vercel.com${path}`, {
          headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "cache-control": "no-cache" },
          redirect: "error", signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) fail("RELEASE_PROVIDER_READBACK_FAILED");
        return response.json();
      };
      let result;
      const runtime = (origin) => readApplicationRuntime(origin, process.env);
      if (mode === "baseline") result = await captureApplicationBaseline(process.env, api, runtime);
      else if (mode === "settled") result = await settleApplicationPromotion(JSON.parse(readFileSync(process.argv[4], "utf8")), process.env, api);
      else if (["candidate", "promoted", "recovered", "recoverable", "unchanged"].includes(mode)) {
        const baseline = JSON.parse(readFileSync(process.argv[4], "utf8"));
        result = mode === "unchanged" ? await verifyApplicationUnchanged(baseline, process.env, api, runtime)
          : mode === "recoverable" ? await verifyApplicationRecoveryAdmission(baseline, process.env, api, runtime, JSON.parse(readFileSync(process.argv[5], "utf8")), async () => {
            const { readConfiguration, assertRecoveryPlan } = await import("./production-application-recovery-plan.mjs");
            const plan = JSON.parse(readFileSync("approved-application-plan/production-application-recovery-plan.json", "utf8"));
            assertRecoveryPlan(plan, process.env.GITHUB_SHA);
            const config = await readConfiguration(api);
            if (config.configurationSha256 !== plan.configurationSha256 || config.backendRef !== plan.backendRef) fail("RELEASE_CONFIG_CHANGED");
          })
          : mode === "recovered" ? await verifyApplicationRecovery(baseline, process.env, api, runtime, JSON.parse(readFileSync(process.argv[5], "utf8")))
            : await verifyApplicationTarget(process.env, baseline, api, mode === "promoted", runtime);
      } else fail("RELEASE_MODE_INVALID");
      writeFileSync(process.argv[3], `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
      if (mode === "settled" && !result.safeToRecover) fail(result.reason);
      if (mode === "baseline") console.log(`RELEASE_ROLLBACK_DEPLOYMENT=${result.recovery.deploymentId}`);
    }
  } catch (error) {
    console.error(/^RELEASE_[A-Z_]+$/u.test(error.message) ? error.message : "RELEASE_TARGET_FAILED");
    process.exitCode = 1;
  }
}
