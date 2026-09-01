import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  DR_OPERATOR_ENTRY,
  buildDrOperatorEntryPlan,
  missingActiveEdgeFunctions,
  validateApprovedDrOperatorEntryPlan,
  validateDrSupabaseBindings,
} from "./lib/dr-operator-entry.mjs";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rollback = args.includes("--rollback");
const approvedPlanPath = valueAfter("--approved-plan");
if (apply && rollback) fail("DR_ENTRY_MODE_INVALID");
if ((apply || rollback) && !approvedPlanPath) fail("DR_ENTRY_APPROVED_PLAN_REQUIRED");

const vercelToken = required("VERCEL_TOKEN");
const vercelTeamId = required("VERCEL_ORG_ID");
const sourceProjectId = required("VERCEL_PROJECT_ID");
const cloudflareToken = required("CLOUDFLARE_API_TOKEN");
const cloudflareZoneId = required("CLOUDFLARE_ZONE_ID");
const drDirectUrl = requiredPostgresUrl("DR_DIRECT_URL");

try {
  if (rollback) {
    requireConfirmation("ROLLBACK_PROTECTED_DR_OPERATOR_ENTRY");
    const plan = await readApprovedPlan();
    const result = await rollbackEntry(plan, {
      targetProjectId: requiredProjectId("DR_OPERATOR_TARGET_PROJECT_ID"),
      drDnsRecordId: process.env.DR_OPERATOR_DNS_RECORD_ID?.trim() || null,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (apply) {
    requireConfirmation("CREATE_PROTECTED_DR_OPERATOR_ENTRY");
    const approvedPlan = await readApprovedPlan();
    const currentPlan = await createPlan();
    if (currentPlan.planDigest !== approvedPlan.planDigest) {
      fail("DR_ENTRY_PROVIDER_STATE_CHANGED_AFTER_PLAN");
    }
    const evidence = await applyEntry(approvedPlan);
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    console.log(JSON.stringify(await createPlan(), null, 2));
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "DR_ENTRY_UNKNOWN_ERROR");
}

async function createPlan() {
  const [source, drRuntime, providers] = await Promise.all([
    readSourceRevision(),
    readDrRuntime(),
    readProviderState(),
  ]);
  return buildDrOperatorEntryPlan({ source, drRuntime, providers });
}

async function readApprovedPlan() {
  const plan = JSON.parse(await readFile(approvedPlanPath, "utf8"));
  return validateApprovedDrOperatorEntryPlan(plan);
}

async function readSourceRevision() {
  const [commitSha, treeSha, stagingTreeSha] = await Promise.all([
    git("rev-parse", "HEAD"),
    git("rev-parse", "HEAD^{tree}"),
    git("rev-parse", "origin/staging^{tree}"),
  ]);
  return {
    repository: process.env.GITHUB_REPOSITORY?.trim() || "local/Stallorder-Platform",
    commitSha,
    treeSha,
    stagingTreeSha,
  };
}

async function readDrRuntime() {
  const client = new PrismaClient({ datasources: { db: { url: drDirectUrl } } });
  try {
    const state = await client.backendRuntimeState.findFirst({
      where: { isCurrent: true },
      select: {
        backendCode: true,
        backendRole: true,
        promotionEpoch: true,
        writesEnabled: true,
        enforcementEnabled: true,
      },
    });
    if (!state) throw new Error("DR_ENTRY_RUNTIME_STATE_MISSING");
    return {
      ...state,
      promotionEpoch: Number(state.promotionEpoch),
      supabaseProjectRef: requiredSupabaseRef("DR_SUPABASE_PROJECT_REF"),
    };
  } finally {
    await client.$disconnect();
  }
}

async function readProviderState() {
  const projectsResponse = await vercel("/v9/projects?limit=100");
  const projects = projectsResponse.projects ?? [];
  const sourceProject = projects.find((project) => project.id === sourceProjectId);
  if (!sourceProject) throw new Error("DR_ENTRY_SOURCE_PROJECT_NOT_FOUND");
  const targetProject = projects.find((project) => project.name === DR_OPERATOR_ENTRY.projectName)
    ?? null;
  const domainSets = await Promise.all(projects.map(async (project) => ({
    project,
    domains: (await vercel(`/v9/projects/${project.id}/domains?limit=100`)).domains ?? [],
  })));
  const sourceDomains = domainSets.find(({ project }) => project.id === sourceProjectId)?.domains
    ?? [];
  const drDomainBindings = domainSets.flatMap(({ project, domains }) => domains
    .filter((domain) => domain.name === DR_OPERATOR_ENTRY.hostname)
    .map((domain) => ({ projectId: project.id, projectName: project.name, domain: safeDomain(domain) })));
  const [drConfig, stagingConfig] = await Promise.all([
    vercelDomainConfig(DR_OPERATOR_ENTRY.hostname),
    vercelDomainConfig(DR_OPERATOR_ENTRY.legacyHostname),
  ]);
  const cnameTarget = preferredCname(drConfig);
  const legacyCnameTarget = preferredCname(stagingConfig);
  if (!cnameTarget || !legacyCnameTarget) throw new Error("DR_ENTRY_CNAME_TARGET_MISSING");

  const records = await cloudflare(`/zones/${cloudflareZoneId}/dns_records?per_page=100`);
  const access = await readCloudflareAccessState();
  return {
    vercel: {
      teamId: vercelTeamId,
      sourceProject: { id: sourceProject.id, name: sourceProject.name },
      targetProject: targetProject
        ? { id: targetProject.id, name: targetProject.name, ssoProtection: targetProject.ssoProtection }
        : null,
      drDomainBindings,
      stagingDomain: safeDomain(sourceDomains.find(
        (domain) => domain.name === DR_OPERATOR_ENTRY.legacyHostname,
      )),
      cnameTarget,
      legacyCnameTarget,
    },
    cloudflare: {
      zoneId: cloudflareZoneId,
      access,
      drRecords: records
        .filter((record) => record.name === DR_OPERATOR_ENTRY.hostname)
        .map(safeDnsRecord),
      stagingRecord: safeDnsRecord(records.find(
        (record) => record.name === DR_OPERATOR_ENTRY.legacyHostname,
      )),
    },
  };
}

async function applyEntry(plan) {
  let targetProjectId = null;
  let drDnsRecordId = null;
  try {
    const project = await vercel("/v11/projects", {
      method: "POST",
      body: JSON.stringify({
        name: plan.target.projectName,
        framework: "nextjs",
        nodeVersion: "24.x",
        skipGitConnectDuringLink: true,
      }),
    });
    targetProjectId = project.id;
    if (!/^prj_[A-Za-z0-9]+$/u.test(targetProjectId ?? "")) {
      throw new Error("DR_ENTRY_PROJECT_CREATE_INVALID");
    }
    await vercel(`/v9/projects/${targetProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ssoProtection: { deploymentType: "all" },
      }),
    });
    await assertTargetProjectProtected(targetProjectId);
    await linkProject(targetProjectId);

    const deploymentUrl = await deployDrRuntime(plan);
    const unauthenticatedDeploymentStatus = await assertProtected(deploymentUrl);
    const deploymentProbe = await vercelCurl(deploymentUrl);
    assertProbeReady(deploymentProbe, plan.target.runtime);
    const supabaseServices = await verifyDrSupabaseServices(plan.target.runtime);

    await vercel(`/v10/projects/${targetProjectId}/domains`, {
      method: "POST",
      body: JSON.stringify({ name: plan.target.hostname }),
    });
    const configuredTarget = await waitForRecommendedCname(
      plan.target.hostname,
      plan.target.cnameTarget,
    );
    const drDnsRecord = await cloudflare(`/zones/${cloudflareZoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: plan.target.hostname,
        content: configuredTarget,
        ttl: 1,
        proxied: false,
        comment: "Protected StallOrder DR operator validation entry",
      }),
    });
    drDnsRecordId = drDnsRecord.id;
    if (!drDnsRecordId) throw new Error("DR_ENTRY_DNS_CREATE_INVALID");
    await waitForDomainConfigured(plan.target.hostname);
    const unauthenticatedCustomDomainStatus = await waitForProtectedDomain(
      `https://${plan.target.hostname}`,
    );
    const customDomainProbe = await vercelCurl(`https://${plan.target.hostname}`);
    assertProbeReady(customDomainProbe, plan.target.runtime);

    await retireLegacyStaging(plan);
    const primaryHealth = await fetch("https://app.qidaigo.com/api/health", {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (primaryHealth.status !== 200) throw new Error("PRIMARY_HEALTH_CHANGED_DURING_DR_ENTRY");
    const finalState = await readProviderStateAfterApply(
      targetProjectId,
      plan.target.cnameTarget,
    );

    const evidence = {
      schemaVersion: 1,
      operation: plan.operation,
      planDigest: plan.planDigest,
      source: plan.source,
      completed: true,
      targetProjectId,
      drDnsRecordId,
      deploymentUrl,
      hostname: plan.target.hostname,
      protection: plan.target.protection,
      unauthenticatedDeploymentStatus,
      unauthenticatedCustomDomainStatus,
      probe: customDomainProbe,
      supabaseServices,
      primaryHealthStatus: primaryHealth.status,
      legacyStagingRetired: finalState.legacyStagingRetired,
      completedAt: new Date().toISOString(),
    };
    await writeEvidence(evidence);
    return evidence;
  } catch (error) {
    const rollbackResult = await rollbackEntry(plan, {
      targetProjectId,
      drDnsRecordId,
    }).catch(() => ({ completed: false }));
    await writeEvidence({
      schemaVersion: 1,
      operation: plan.operation,
      planDigest: plan.planDigest,
      source: plan.source,
      completed: false,
      reasonCode: error instanceof Error ? error.message : "DR_ENTRY_APPLY_FAILED",
      rollbackCompleted: rollbackResult.completed === true,
      failedAt: new Date().toISOString(),
    }).catch(() => {});
    if (rollbackResult.completed !== true) {
      throw new Error("DR_ENTRY_APPLY_FAILED_ROLLBACK_INCOMPLETE");
    }
    throw new Error(error instanceof Error ? error.message : "DR_ENTRY_APPLY_FAILED");
  }
}

async function deployDrRuntime(plan) {
  assertDrEnvironmentBindings(plan.target.runtime.supabaseProjectRef);
  const deploymentArgs = [
    "deploy", ".", "--prod", "--skip-domain", "--force", "--yes",
    "--local-config", "vercel.dr.json", "--token", vercelToken,
    "--meta", `source_commit=${plan.source.commitSha}`,
    "--meta", "backend_target=DR",
  ];
  const buildAndRuntime = {
    DATABASE_URL: required("DR_RUNTIME_DATABASE_URL"),
    DIRECT_URL: drDirectUrl,
    NEXT_PUBLIC_SUPABASE_URL: required("DR_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required("DR_SUPABASE_PUBLISHABLE_KEY"),
    NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: required("DR_SUPABASE_FUNCTIONS_URL"),
    DR_SUPABASE_PROJECT_REF: plan.target.runtime.supabaseProjectRef,
    BACKEND_ACTIVE_TARGET: "DR",
    AUTH_PROJECT_CODE: "DR",
    PROMOTION_EPOCH: String(plan.target.runtime.promotionEpoch),
    DR_OPERATOR_PROBE_ENABLED: "true",
    APP_BASE_URL: `https://${plan.target.hostname}`,
    NEXT_PUBLIC_APP_URL: `https://${plan.target.hostname}`,
    TRUSTED_APP_ORIGINS: `https://${plan.target.hostname}`,
    NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED: "false",
    ALLOW_DEMO_SEED: "false",
    LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT: "false",
  };
  const runtimeOnly = {
    SUPABASE_SECRET_KEY: required("DR_SUPABASE_SECRET_KEY"),
    PUBLIC_ORDER_FUNCTION_ORIGIN: required("DR_SUPABASE_FUNCTIONS_URL"),
    DR_DATABASE_URL: required("DR_RUNTIME_DATABASE_URL"),
    DR_DIRECT_URL: drDirectUrl,
  };
  for (const [name, value] of Object.entries(buildAndRuntime)) {
    deploymentArgs.push("--build-env", `${name}=${value}`, "--env", `${name}=${value}`);
  }
  for (const [name, value] of Object.entries(runtimeOnly)) {
    deploymentArgs.push("--env", `${name}=${value}`);
  }

  const output = await runVercel(deploymentArgs, "DR_ENTRY_DEPLOY_FAILED");
  const deploymentUrl = output.split(/\r?\n/u).map((value) => value.trim()).findLast(
    (value) => /^https:\/\/[a-z0-9.-]+\.vercel\.app$/u.test(value),
  );
  if (!deploymentUrl) throw new Error("DR_ENTRY_DEPLOYMENT_URL_MISSING");
  return deploymentUrl;
}

async function vercelCurl(baseUrl) {
  const output = await runVercel([
    "curl",
    planProbePath(),
    "--deployment",
    baseUrl,
    "--yes",
    "--token",
    vercelToken,
  ], "DR_ENTRY_PROTECTED_PROBE_FAILED");
  const start = output.indexOf("{");
  if (start < 0) throw new Error("DR_ENTRY_PROBE_JSON_MISSING");
  return JSON.parse(output.slice(start));
}

function assertProbeReady(probe, expectedRuntime) {
  if (
    probe?.status !== "READY"
    || probe.runtime?.backendTarget !== "DR"
    || probe.runtime?.authProjectCode !== "DR"
    || probe.runtime?.promotionEpoch !== expectedRuntime.promotionEpoch
    || probe.runtime?.supabaseProjectRef !== expectedRuntime.supabaseProjectRef
    || probe.database?.backendCode !== "DR"
    || probe.database?.backendRole !== "READ_ONLY_STANDBY"
    || probe.database?.writesEnabled !== false
    || probe.database?.enforcementEnabled !== true
    || !Object.values(probe.checks ?? {}).every(Boolean)
  ) {
    throw new Error("DR_ENTRY_PROBE_NOT_READY");
  }
}

async function verifyDrSupabaseServices(expectedRuntime) {
  const projectRef = requiredSupabaseRef("DR_SUPABASE_PROJECT_REF");
  const supabaseUrl = required("DR_SUPABASE_URL").replace(/\/$/u, "");
  const publishableKey = required("DR_SUPABASE_PUBLISHABLE_KEY");
  assertDrEnvironmentBindings(expectedRuntime.supabaseProjectRef);

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/health`, {
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (authResponse.status !== 200) throw new Error(`DR_ENTRY_AUTH_HEALTH_${authResponse.status}`);
  await authResponse.arrayBuffer();

  const storageResponse = await fetch(`${supabaseUrl}/storage/v1/status`, {
    headers: { apikey: publishableKey },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (storageResponse.status !== 200) {
    throw new Error(`DR_ENTRY_STORAGE_HEALTH_${storageResponse.status}`);
  }
  await storageResponse.arrayBuffer();

  const expectedFunctions = await sourceFunctionNames();
  if (expectedFunctions.length === 0) throw new Error("DR_ENTRY_EDGE_FUNCTION_SOURCE_EMPTY");
  const deployedFunctions = await listDeployedFunctions(projectRef);
  const missingFunctions = missingActiveEdgeFunctions(expectedFunctions, deployedFunctions);
  if (missingFunctions.length > 0) throw new Error("DR_ENTRY_EDGE_FUNCTIONS_INCOMPLETE");

  return {
    projectBinding: true,
    authStatus: authResponse.status,
    storageStatus: storageResponse.status,
    expectedEdgeFunctions: expectedFunctions.length,
    activeEdgeFunctions: expectedFunctions.length,
  };
}

function assertDrEnvironmentBindings(projectRef) {
  validateDrSupabaseBindings({
    expectedProjectRef: projectRef,
    actualProjectRef: requiredSupabaseRef("DR_SUPABASE_PROJECT_REF"),
    supabaseUrl: required("DR_SUPABASE_URL"),
    functionsUrl: required("DR_SUPABASE_FUNCTIONS_URL"),
  });
}

async function sourceFunctionNames() {
  const entries = await readdir("supabase/functions", { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    try {
      await access(path.join("supabase", "functions", entry.name, "index.ts"));
      names.push(entry.name);
    } catch {
      // Directories without an entrypoint are not deployable Edge Functions.
    }
  }
  return names.sort();
}

async function listDeployedFunctions(projectRef) {
  try {
    const result = await execFileAsync(
      "supabase",
      ["functions", "list", "--project-ref", projectRef, "--output", "json"],
      {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const functions = JSON.parse(result.stdout);
    if (!Array.isArray(functions)) throw new Error("DR_ENTRY_EDGE_FUNCTIONS_INVALID");
    return functions;
  } catch {
    throw new Error("DR_ENTRY_EDGE_FUNCTIONS_READBACK_FAILED");
  }
}

async function assertProtected(baseUrl) {
  const response = await fetch(`${baseUrl}${planProbePath()}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (![301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
    throw new Error("DR_ENTRY_UNAUTHENTICATED_ACCESS_NOT_BLOCKED");
  }
  return response.status;
}

async function waitForProtectedDomain(baseUrl) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      return await assertProtected(baseUrl);
    } catch {
      if (attempt === 30) break;
      await delay(10_000);
    }
  }
  throw new Error("DR_ENTRY_CUSTOM_DOMAIN_PROTECTION_TIMEOUT");
}

async function waitForRecommendedCname(hostname, expected) {
  const config = await vercelDomainConfig(hostname);
  const values = (config.recommendedCNAME ?? []).map((entry) => entry.value.replace(/\.$/u, ""));
  if (!values.includes(expected)) throw new Error("DR_ENTRY_CNAME_TARGET_CHANGED");
  return expected;
}

async function waitForDomainConfigured(hostname) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const config = await vercelDomainConfig(hostname);
    if (config.misconfigured === false) return;
    if (attempt < 30) await delay(10_000);
  }
  throw new Error("DR_ENTRY_DOMAIN_CONFIGURATION_TIMEOUT");
}

async function retireLegacyStaging(plan) {
  await vercel(
    `/v9/projects/${sourceProjectId}/domains/${encodeURIComponent(DR_OPERATOR_ENTRY.legacyHostname)}`,
    { method: "DELETE" },
  );
  await cloudflare(
    `/zones/${cloudflareZoneId}/dns_records/${plan.before.legacyStaging.cloudflare.id}`,
    { method: "DELETE" },
  );
}

async function rollbackEntry(plan, { targetProjectId, drDnsRecordId }) {
  const projects = (await vercel("/v9/projects?limit=100")).projects ?? [];
  const target = projects.find((project) => project.name === plan.target.projectName);
  const records = await cloudflare(`/zones/${cloudflareZoneId}/dns_records?per_page=100`);
  if (!drDnsRecordId && records.some((entry) => entry.name === plan.target.hostname)) {
    throw new Error("DR_ENTRY_ROLLBACK_DNS_IDENTITY_MISMATCH");
  }
  if (drDnsRecordId) {
    const createdRecord = records.find((entry) => entry.id === drDnsRecordId);
    if (createdRecord) {
      if (
        createdRecord.name !== plan.target.hostname
        || createdRecord.type !== "CNAME"
        || String(createdRecord.content ?? "").replace(/\.$/u, "") !== plan.target.cnameTarget
        || createdRecord.proxied !== false
      ) {
        throw new Error("DR_ENTRY_ROLLBACK_DNS_IDENTITY_MISMATCH");
      }
      await cloudflare(`/zones/${cloudflareZoneId}/dns_records/${createdRecord.id}`, {
        method: "DELETE",
      });
    }
  }
  if (target) {
    if (!targetProjectId || target.id !== targetProjectId) {
      throw new Error("DR_ENTRY_ROLLBACK_PROJECT_IDENTITY_MISMATCH");
    }
    await vercel(`/v9/projects/${target.id}`, { method: "DELETE" });
  }

  const sourceDomains = (await vercel(
    `/v9/projects/${sourceProjectId}/domains?limit=100`,
  )).domains ?? [];
  if (!sourceDomains.some((domain) => domain.name === DR_OPERATOR_ENTRY.legacyHostname)) {
    const before = plan.before.legacyStaging.vercel;
    await vercel(`/v10/projects/${sourceProjectId}/domains`, {
      method: "POST",
      body: JSON.stringify({
        name: before.name,
        gitBranch: before.gitBranch,
        ...(before.redirect ? {
          redirect: before.redirect,
          redirectStatusCode: before.redirectStatusCode,
        } : {}),
      }),
    });
  }
  const refreshedRecords = await cloudflare(
    `/zones/${cloudflareZoneId}/dns_records?per_page=100`,
  );
  if (!refreshedRecords.some((record) => record.name === DR_OPERATOR_ENTRY.legacyHostname)) {
    const before = plan.before.legacyStaging.cloudflare;
    await cloudflare(`/zones/${cloudflareZoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: before.type,
        name: before.name,
        content: before.content,
        ttl: before.ttl,
        proxied: before.proxied,
        comment: "Restored by StallOrder DR operator entry rollback",
      }),
    });
  }
  await waitForRollbackState(plan);
  return {
    schemaVersion: 1,
    operation: "ROLLBACK_PROTECTED_DR_OPERATOR_ENTRY",
    planDigest: plan.planDigest,
    completed: true,
    completedAt: new Date().toISOString(),
  };
}

async function waitForRollbackState(plan) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const [projectsResponse, sourceDomainsResponse, records] = await Promise.all([
      vercel("/v9/projects?limit=100"),
      vercel(`/v9/projects/${sourceProjectId}/domains?limit=100`),
      cloudflare(`/zones/${cloudflareZoneId}/dns_records?per_page=100`),
    ]);
    const targetAbsent = !(projectsResponse.projects ?? []).some(
      (project) => project.name === plan.target.projectName,
    );
    const drDnsAbsent = !records.some((record) => record.name === plan.target.hostname);
    const restoredVercel = (sourceDomainsResponse.domains ?? []).some((domain) =>
      domain.name === plan.before.legacyStaging.vercel.name
      && (domain.gitBranch ?? null) === plan.before.legacyStaging.vercel.gitBranch);
    const restoredDns = records.some((record) =>
      record.name === plan.before.legacyStaging.cloudflare.name
      && record.type === plan.before.legacyStaging.cloudflare.type
      && String(record.content ?? "").replace(/\.$/u, "")
        === plan.before.legacyStaging.cloudflare.content
      && record.proxied === plan.before.legacyStaging.cloudflare.proxied);
    if (targetAbsent && drDnsAbsent && restoredVercel && restoredDns) return;
    if (attempt < 12) await delay(5_000);
  }
  throw new Error("DR_ENTRY_ROLLBACK_READBACK_FAILED");
}

async function readProviderStateAfterApply(targetProjectId, expectedCnameTarget) {
  await assertTargetProjectProtected(targetProjectId);
  const sourceDomains = (await vercel(
    `/v9/projects/${sourceProjectId}/domains?limit=100`,
  )).domains ?? [];
  const targetDomains = (await vercel(
    `/v9/projects/${targetProjectId}/domains?limit=100`,
  )).domains ?? [];
  const records = await cloudflare(`/zones/${cloudflareZoneId}/dns_records?per_page=100`);
  const drRecord = records.find((record) => record.name === DR_OPERATOR_ENTRY.hostname);
  const stagingRecord = records.find((record) => record.name === DR_OPERATOR_ENTRY.legacyHostname);
  if (!targetDomains.some((domain) => domain.name === DR_OPERATOR_ENTRY.hostname)) {
    throw new Error("DR_ENTRY_DOMAIN_READBACK_FAILED");
  }
  if (
    !drRecord
    || drRecord.content.replace(/\.$/u, "") !== expectedCnameTarget
    || drRecord.type !== "CNAME"
    || drRecord.proxied !== false
  ) {
    throw new Error("DR_ENTRY_DNS_READBACK_FAILED");
  }
  const legacyStagingRetired = !sourceDomains.some(
    (domain) => domain.name === DR_OPERATOR_ENTRY.legacyHostname,
  ) && !stagingRecord;
  if (!legacyStagingRetired) throw new Error("LEGACY_STAGING_RETIREMENT_READBACK_FAILED");
  return { legacyStagingRetired };
}

async function assertTargetProjectProtected(projectId) {
  const project = await vercel(`/v9/projects/${projectId}`);
  if (project.ssoProtection?.deploymentType !== "all") {
    throw new Error("DR_ENTRY_ALL_DEPLOYMENTS_PROTECTION_UNAVAILABLE");
  }
}

async function linkProject(projectId) {
  await mkdir(".vercel", { recursive: true });
  await writeFile(
    ".vercel/project.json",
    `${JSON.stringify({ orgId: vercelTeamId, projectId })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

async function readCloudflareAccessState() {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}/access/apps?per_page=100`,
    { headers: cloudflareHeaders(), signal: AbortSignal.timeout(30_000) },
  );
  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.success) {
    return { enabled: true, applicationCount: payload.result?.length ?? 0 };
  }
  const notEnabled = payload?.errors?.some((error) => {
    const code = String(error.code ?? "").toLowerCase();
    const message = String(error.message ?? "").toLowerCase();
    return code.includes("not_enabled")
      || message.includes("not_enabled")
      || message.includes("access is not enabled");
  });
  if (notEnabled) return { enabled: false, reason: "NOT_ENABLED" };
  throw new Error(`CLOUDFLARE_ACCESS_STATE_${response.status}`);
}

async function vercel(path, init = {}) {
  return providerRequest(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(vercelTeamId)}`, {
    ...init,
    headers: { authorization: `Bearer ${vercelToken}`, "content-type": "application/json" },
  }, "VERCEL");
}

async function vercelDomainConfig(hostname) {
  return vercel(`/v6/domains/${encodeURIComponent(hostname)}/config`);
}

async function cloudflare(path, init = {}) {
  return providerRequest(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: cloudflareHeaders(),
  }, "CLOUDFLARE", true);
}

async function providerRequest(url, init, provider, unwrapResult = false) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || (unwrapResult && payload?.success !== true)) {
    throw new Error(`${provider}_API_${response.status}`);
  }
  return unwrapResult ? payload.result : payload;
}

function cloudflareHeaders() {
  return { authorization: `Bearer ${cloudflareToken}`, "content-type": "application/json" };
}

async function runVercel(commandArgs, errorCode) {
  try {
    const result = await execFileAsync("vercel", commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    throw new Error(errorCode);
  }
}

async function git(...commandArgs) {
  const result = await execFileAsync("git", commandArgs, { cwd: process.cwd() });
  return result.stdout.trim();
}

async function writeEvidence(evidence) {
  const evidencePath = process.env.DR_OPERATOR_EVIDENCE_PATH?.trim();
  if (!evidencePath) return;
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function safeDomain(domain) {
  if (!domain) return null;
  return {
    name: domain.name,
    gitBranch: domain.gitBranch ?? null,
    redirect: domain.redirect ?? null,
    redirectStatusCode: domain.redirectStatusCode ?? null,
  };
}

function safeDnsRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    content: String(record.content ?? "").replace(/\.$/u, ""),
    proxied: record.proxied,
    ttl: record.ttl,
  };
}

function preferredCname(config) {
  return config.recommendedCNAME
    ?.slice()
    .sort((left, right) => left.rank - right.rank)[0]
    ?.value
    ?.replace(/\.$/u, "");
}

function planProbePath() {
  return "/api/health/dr/operator";
}

function requireConfirmation(expected) {
  if (process.env.DR_OPERATOR_ENTRY_CONFIRMATION !== expected) {
    throw new Error("DR_ENTRY_CONFIRMATION_INVALID");
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /[\r\n]/u.test(value)) throw new Error(`${name}_MISSING_OR_INVALID`);
  return value;
}

function requiredPostgresUrl(name) {
  const value = required(name);
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function requiredSupabaseRef(name) {
  const value = required(name);
  if (!/^[a-z]{20}$/u.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function requiredProjectId(name) {
  const value = required(name);
  if (!/^prj_[A-Za-z0-9]+$/u.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function valueAfter(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  console.error(JSON.stringify({ event: "dr_operator_entry_failed", reason: message }));
  process.exit(1);
}
