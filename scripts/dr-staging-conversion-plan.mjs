// Read-only, source-bound Plan for the approved retirement of the existing DR.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openBackup } from "./backup-dr-for-staging.mjs";
import { assertRestorationEvidence, assertPrimaryIsolation } from "./convert-dr-to-staging.mjs";
import { normalizeProtectedSecret } from "./lib/protected-secret.mjs";

export const STAGING_TARGET = Object.freeze({
  ref: "daeqwtpaxcebmtwxqdkj", project: "prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3",
  primaryProject: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", team: "team_MMfsiG94K9Zy3e6w7Ccc9xY4",
  account: "b1c70202652cd3b77dfec70e5463785f", zone: "8f8070a80ad4182e4af0c11a1b496968",
  host: "staging.qidaigo.com", oldAccessId: "9fa19a57-1d8a-42c4-8544-2edd7687074b",
  oldDnsId: "0ab6a8cd68e4b47281bcef8216606625",
});

export const RETIRED_HOSTS = Object.freeze(["dr.qidaigo.com", "stallorder-dr.vercel.app"]);

export function conversionDigest(value) {
  return createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
}

export function sourceFingerprintQuery(tables) {
  const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  assert.ok(Array.isArray(tables) && tables.length > 0, "STAGING_TABLE_SCOPE_INVALID");
  return tables.map(({ schema, name, columns }) => {
    assert.ok(["public", "auth", "storage", "app_private", "internal", "vault"].includes(schema)
      && typeof name === "string" && Array.isArray(columns) && columns.length > 0
      && columns.every((column) => typeof column === "string"), "STAGING_TABLE_SCOPE_INVALID");
    return `select json_build_object('table',${literal(`${schema}.${name}`)},'rows',count(*),
      'digest',md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),''))) as fingerprint
      from (select ${columns.map(identifier).join(",")} from ${identifier(schema)}.${identifier(name)}) t`;
  }).join(" union all ");
}

export function requireConversionInvocation() {
  assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform"
    && process.env.GITHUB_ACTOR === "KenLeeYa" && process.env.GITHUB_REF === "refs/heads/main",
  "STAGING_INVOCATION_INVALID");
}

export async function verifyConversionSourceChecks() {
  const main = conversionRequired("GITHUB_SHA");
  const staging = execFileSync("git", ["rev-parse", "origin/staging"], { encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase()))) }).trim();
  return verifySourceCheckShas(main, staging);
}

async function verifySourceCheckShas(main, staging) {
  const evidence = [];
  for (const sha of new Set([main, staging])) {
    // Fixed fields only: never log tokens, response bodies, titles or raw headers.
    console.error(JSON.stringify({ event: "staging-source-query", sha }));
    const { workflow_runs: runs, total_count: count } = await conversionApi("github",
      `/repos/KenLeeYa/Stallorder-Platform/actions/runs?head_sha=${sha}&event=push&per_page=100`);
    console.error(JSON.stringify({ event: "staging-source-list", sha,
      totalCount: Number.isSafeInteger(count) ? count : null,
      returnedCount: Array.isArray(runs) ? runs.length : null, unambiguous: count < 100 }));
    assert.ok(count < 100, "STAGING_SOURCE_CHECKS_AMBIGUOUS");
    for (const path of ["ci.yml", "codeql.yml", "production-readiness.yml"]) {
      const run = runs.find((item) => item.path === `.github/workflows/${path}`);
      console.error(JSON.stringify({ event: "staging-source-check", sha, workflow: path,
        totalCount: Number.isSafeInteger(count) ? count : null, returnedCount: runs.length,
        found: Boolean(run), shaMatches: run?.head_sha === sha,
        completed: run?.status === "completed", successful: run?.conclusion === "success",
        runId: Number.isSafeInteger(run?.id) ? run.id : null,
        attempt: Number.isSafeInteger(run?.run_attempt) ? run.run_attempt : null,
        returnedSha: /^[a-f0-9]{40}$/.test(run?.head_sha ?? "") ? run.head_sha : null,
      }));
      assert.ok(run?.head_sha === sha && run.status === "completed" && run.conclusion === "success",
        "STAGING_SOURCE_CHECKS_NOT_PASSED");
      evidence.push({ sha, workflow: path, runId: run.id, attempt: run.run_attempt });
    }
  }
  return evidence;
}

// Replay only the source-list seam for a recorded equal-tree pair. This does not
// qualify a Plan: current refs, backup, provider drift and Primary are not checked.
export async function diagnoseConversionSourceChecks() {
  requireConversionInvocation();
  const main = conversionRequired("DIAGNOSTIC_MAIN_SHA");
  const staging = conversionRequired("DIAGNOSTIC_STAGING_SHA");
  for (const sha of [main, staging]) assert.match(sha, /^[a-f0-9]{40}$/, "STAGING_DIAGNOSTIC_SOURCE_INVALID");
  const tree = (sha) => execFileSync("git", ["rev-parse", `${sha}^{tree}`], { encoding: "utf8" }).trim();
  assert.equal(tree(main), tree(staging), "STAGING_DIAGNOSTIC_TREE_MISMATCH");
  const evidence = await verifySourceCheckShas(main, staging);
  console.log(JSON.stringify({ event: "staging-source-diagnostic", diagnosticOnly: true,
    planQualified: false, evidence: evidence.map(({ sha, workflow, runId, attempt }) => ({
      sha, workflow, runId: Number.isSafeInteger(runId) ? runId : null,
      attempt: Number.isSafeInteger(attempt) ? attempt : null,
    })) }));
  return evidence;
}

export function conversionRequired(name) {
  const value = process.env[name];
  assert.ok(value?.trim(), "STAGING_CONFIGURATION_MISSING");
  // The backup writer derives its AES key from the original password bytes.
  // API token normalization must never alter that cryptographic input.
  return name === "DR_BACKUP_ENCRYPTION_KEY" ? value : value.trim();
}

export function assertConversionWriteScope(provider, path, method) {
  if (["GET", "HEAD"].includes(method)) return;
  const scoped = provider === "supabase" ? path.startsWith(`/v1/projects/${STAGING_TARGET.ref}/`)
    : provider === "vercel" ? [9, 10].some((version) => path.startsWith(`/v${version}/projects/${STAGING_TARGET.project}/`))
      || (method === "POST" && /^\/v2\/deployments\/dpl_[a-zA-Z0-9]+\/aliases$/.test(path))
      || (method === "DELETE" && /^\/v2\/aliases\/[a-f0-9]{128}$/.test(path))
      || (method === "PATCH" && /^\/aliases\/[a-f0-9]{128}\/protection-bypass$/.test(path))
      : provider === "cloudflare" && ((method === "DELETE" && [
        `/accounts/${STAGING_TARGET.account}/access/apps/${STAGING_TARGET.oldAccessId}`,
        `/zones/${STAGING_TARGET.zone}/dns_records/${STAGING_TARGET.oldDnsId}`,
      ].includes(path)) || (!path.includes(STAGING_TARGET.oldAccessId)
        && ((path === `/accounts/${STAGING_TARGET.account}/access/apps` && method === "POST")
          || new RegExp(`^/accounts/${STAGING_TARGET.account}/access/apps/[a-f0-9-]{36}(?:/policies(?:/[a-f0-9-]{36})?)?$`).test(path)
          || path.startsWith(`/accounts/${STAGING_TARGET.account}/access/service_tokens`)
          || (method === "POST" && path === `/zones/${STAGING_TARGET.zone}/dns_records`)
          || (method === "PATCH" && new RegExp(`^/zones/${STAGING_TARGET.zone}/dns_records/[a-f0-9]{32}$`).test(path)))));
  assert.ok(scoped, "STAGING_WRITE_SCOPE_INVALID");
}

export async function conversionApi(provider, path, options = {}) {
  const method = options.method ?? "GET";
  assertConversionWriteScope(provider, path, method);
  const routes = {
    github: ["https://api.github.com", "GITHUB_TOKEN"],
    vercel: ["https://api.vercel.com", "VERCEL_TOKEN"],
    cloudflare: ["https://api.cloudflare.com/client/v4", "CLOUDFLARE_API_TOKEN"],
    supabase: ["https://api.supabase.com", "SUPABASE_ACCESS_TOKEN"],
  };
  const [base, tokenName] = routes[provider] ?? [];
  assert.ok(base && path.startsWith("/") && !path.startsWith("//"), "STAGING_PROVIDER_TARGET_INVALID");
  // Supabase operations in this conversion can never address Primary.
  if (provider === "supabase") assert.ok(path.startsWith(`/v1/projects/${STAGING_TARGET.ref}/`), "STAGING_PROVIDER_TARGET_INVALID");
  if (provider === "vercel" && method === "DELETE") {
    const aliasId = path.startsWith("/v2/aliases/") ? path.split("/").at(-1) : null;
    assert.ok(aliasId || RETIRED_HOSTS.some(host => path === `/v9/projects/${STAGING_TARGET.project}/domains/${host}`),
      "STAGING_WRITE_HOST_INVALID");
    const current = await conversionApi("vercel", aliasId ? `/v4/aliases/${aliasId}` : path);
    assert.equal(current.projectId, STAGING_TARGET.project, "STAGING_WRITE_HOST_INVALID");
    if (aliasId) assert.ok(current.uid === aliasId && RETIRED_HOSTS.includes(current.alias), "STAGING_WRITE_HOST_INVALID");
  }
  if (provider === "vercel" && method === "POST" && path.startsWith("/v2/deployments/")) {
    const deployment = await conversionApi("vercel", `/v13/deployments/${path.split("/")[3]}`);
    assert.ok(deployment.projectId === STAGING_TARGET.project && [null, "preview"].includes(deployment.target)
      && deployment.readyState === "READY" && deployment.meta?.git_commit === conversionRequired("GITHUB_SHA"),
    "STAGING_ALIAS_TARGET_INVALID");
    assert.equal(JSON.parse(options.body).alias, STAGING_TARGET.host, "STAGING_WRITE_HOST_INVALID");
  }
  if (provider === "vercel" && method === "PATCH" && path.startsWith("/aliases/")) {
    const alias = await conversionApi("vercel", `/v4/aliases/${path.split("/")[2]}`);
    assert.ok(alias.alias === STAGING_TARGET.host && alias.projectId === STAGING_TARGET.project
      && alias.uid === path.split("/")[2], "STAGING_WRITE_HOST_INVALID");
    const deployment = await conversionApi("vercel", `/v13/deployments/${alias.deploymentId}`);
    assert.ok(deployment.projectId === STAGING_TARGET.project && [null, "preview"].includes(deployment.target)
      && deployment.readyState === "READY" && deployment.meta?.git_commit === conversionRequired("GITHUB_SHA"),
    "STAGING_ALIAS_TARGET_INVALID");
    const body = JSON.parse(options.body);
    assert.ok(["create", "revoke"].includes(body.override?.action), "STAGING_ALIAS_EXCEPTION_INVALID");
    assert.deepEqual(body, { override: { action: body.override.action, scope: "alias-protection-override" } },
      "STAGING_ALIAS_EXCEPTION_INVALID");
  }
  if (provider === "cloudflare" && !["GET", "HEAD"].includes(method)) {
    const appPrefix = `/accounts/${STAGING_TARGET.account}/access/apps`;
    const retiring = method === "DELETE" && (path === `${appPrefix}/${STAGING_TARGET.oldAccessId}`
      || path === `/zones/${STAGING_TARGET.zone}/dns_records/${STAGING_TARGET.oldDnsId}`);
    if (retiring) {
      const receipt = JSON.parse(await readFile("artifacts/staging-acceptance.json", "utf8"));
      assert.ok(receipt.sourceSha === conversionRequired("GITHUB_SHA") && receipt.backend === STAGING_TARGET.ref
        && receipt.origin === `https://${STAGING_TARGET.host}` && receipt.primaryWrites === false
        && receipt.anonymousAccessDenied && receipt.generatedOriginProtected, "STAGING_ACCEPTANCE_REQUIRED");
      const current = await conversionApi("cloudflare", path);
      assert.equal(current.domain ?? current.name, "dr.qidaigo.com", "STAGING_WRITE_HOST_INVALID");
    } else if (path === appPrefix || path === `/zones/${STAGING_TARGET.zone}/dns_records`) {
      const body = JSON.parse(options.body);
      assert.equal(path === appPrefix ? body.domain : body.name, STAGING_TARGET.host, "STAGING_WRITE_HOST_INVALID");
    } else if (path.startsWith(`${appPrefix}/`)) {
      const id = path.slice(appPrefix.length + 1).split("/")[0];
      assert.match(id, /^[a-f0-9-]{36}$/);
      const app = await conversionApi("cloudflare", `${appPrefix}/${id}`);
      assert.equal(app.domain, STAGING_TARGET.host, "STAGING_WRITE_HOST_INVALID");
    } else if (method === "PATCH" && path.startsWith(`/zones/${STAGING_TARGET.zone}/dns_records/`)) {
      const dns = await conversionApi("cloudflare", path);
      assert.ok(dns.name === STAGING_TARGET.host && dns.type === "CNAME" && dns.content === "cname.vercel-dns.com",
        "STAGING_WRITE_HOST_INVALID");
      const body = JSON.parse(options.body);
      assert.ok(Object.keys(body).every((key) => ["proxied", "ttl"].includes(key))
        && typeof body.proxied === "boolean" && [1, 60].includes(body.ttl), "STAGING_DNS_PATCH_INVALID");
    }
  }
  const { value } = normalizeProtectedSecret(conversionRequired(tokenName), tokenName);
  const suffix = provider === "vercel" ? `${path.includes("?") ? "&" : "?"}teamId=${STAGING_TARGET.team}` : "";
  const response = await fetch(`${base}${path}${suffix}`, {
    ...options, headers: { authorization: `Bearer ${value}`, "content-type": "application/json", ...options.headers },
    redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) console.error(JSON.stringify({ provider, method, path: new URL(path, base).pathname, status: response.status }));
  assert.ok(response.ok, `STAGING_${provider.toUpperCase()}_HTTP_${response.status}`);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (provider !== "cloudflare") return body;
  assert.equal(body.success, true, "STAGING_CLOUDFLARE_REQUEST_FAILED");
  return body.result;
}

export async function readConversionBackup() {
  const runId = conversionRequired("BACKUP_RUN_ID");
  assert.match(runId, /^[1-9][0-9]+$/);
  const prefix = `/repos/KenLeeYa/Stallorder-Platform/actions/runs/${runId}`;
  const run = await conversionApi("github", prefix);
  assert.ok(run.status === "completed" && run.conclusion === "success" && run.actor?.login === "KenLeeYa"
    && run.path === ".github/workflows/dr-staging-backup.yml"
    && run.head_branch === "codex/dr-staging-transition-20261022", "STAGING_BACKUP_RUN_INVALID");
  const artifacts = await conversionApi("github", `${prefix}/artifacts`);
  const artifact = artifacts.artifacts.find((item) => item.name === `dr-retirement-encrypted-${runId}`);
  assert.ok(artifact && !artifact.expired && /^sha256:[a-f0-9]{64}$/.test(artifact.digest)
    && Date.parse(artifact.expires_at) > Date.now() + 86_400_000, "STAGING_BACKUP_ARTIFACT_INVALID");
  const directory = resolve("approved-backup");
  const manifest = JSON.parse(openBackup(await readFile(resolve(directory, "manifest.json.enc")),
    conversionRequired("DR_BACKUP_ENCRYPTION_KEY")).toString());
  const proof = JSON.parse(await readFile(resolve(directory, "verification.json"), "utf8"));
  const rehearsal = JSON.parse(await readFile(resolve(directory, "reset-rehearsal.json"), "utf8"));
  const migrationCount = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).length;
  const identity = { runId, commit: run.head_sha };
  assertRestorationEvidence(proof, manifest, rehearsal, identity, migrationCount);
  // The qualified rehearsal must use the exact migrations and seed being applied.
  execFileSync("git", ["diff", "--exit-code", run.head_sha, "HEAD", "--", "supabase/migrations", "supabase/seed.sql",
    "scripts/rehearse-dr-staging-reset.mjs", "scripts/lib/dr-reset-preparation.mjs"], { stdio: "ignore" });
  for (const archive of [manifest.archive, ...manifest.files, ...(manifest.recovery ? [manifest.recovery] : [])]) {
    assert.match(archive.name, /^(?:database\.dump|object-[0-9]+|reference-recovery\.json)\.enc$/);
    assert.equal(conversionDigest(await readFile(resolve(directory, archive.name))), archive.sha256, "STAGING_BACKUP_BYTES_CHANGED");
  }
  return { manifest, proof, rehearsal, identity: { ...identity, artifactId: artifact.id, artifactDigest: artifact.digest }, migrationCount };
}

export async function readConversionPrimary() {
  const host = "app.qidaigo.com";
  const publicRead = async (path, json = true) => {
    const response = await fetch(`https://${host}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, "STAGING_PRIMARY_UNHEALTHY");
    return json ? response.json() : Boolean(await response.arrayBuffer());
  };
  const [deployment, alias, environment, version, availability, dns] = await Promise.all([
    conversionApi("vercel", `/v13/deployments/${host}`), conversionApi("vercel", `/v4/aliases/${host}`),
    conversionApi("vercel", `/v9/projects/${STAGING_TARGET.primaryProject}/env`),
    publicRead("/api/version"), publicRead("/api/availability/config"),
    conversionApi("cloudflare", `/zones/${STAGING_TARGET.zone}/dns_records?name=${host}`),
    publicRead("/api/connectivity", false), publicRead("/login", false),
  ]);
  assertPrimaryIsolation({ deployment, alias, environment, version, availability });
  assert.equal(dns.length, 1, "STAGING_PRIMARY_DNS_AMBIGUOUS");
  return { deploymentId: deployment.id, deploymentUrl: deployment.url, revision: version.revision,
    promotionEpoch: availability.promotionEpoch, aliasId: alias.uid ?? alias.id,
    dns: dns.map(({ id, name, type, content, proxied }) => ({ id, name, type, content, proxied })),
    environmentDigest: conversionDigest(environment.envs.map(({ id, key, target, updatedAt }) => ({ id, key, target, updatedAt }))
      .sort((a, b) => a.id.localeCompare(b.id))) };
}

export async function conversionQuery(query, readOnly = true) {
  return conversionApi("supabase", `/v1/projects/${STAGING_TARGET.ref}/database/query`, {
    method: "POST", body: JSON.stringify({ query, read_only: readOnly }),
  });
}

export async function verifyOriginalReplica(manifest) {
  const [state] = await conversionQuery(`select (select count(*) from pg_subscription)::int as subscriptions,
    exists(select 1 from public.backend_runtime_state where backend_code='DR' and is_current
      and backend_role='READ_ONLY_STANDBY' and not writes_enabled and enforcement_enabled) as fenced,
    (select count(*) from cron.job where active)::int as active_crons,
    (select count(*) from net.http_request_queue)::int as outgoing_requests,
    has_table_privilege('postgres','vault.secrets','DELETE') as can_remove_vault,
    has_function_privilege('postgres','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE') as can_stop_crons`);
  assert.ok(state.subscriptions === 0 && state.fenced && state.active_crons === 0
    && state.outgoing_requests === 0 && state.can_remove_vault && state.can_stop_crons, "STAGING_REPLICA_NOT_FENCED");
  const fingerprints = (await conversionQuery(sourceFingerprintQuery(manifest.tables)))
    .map((row) => row.fingerprint).sort((a, b) => a.table.localeCompare(b.table));
  assert.deepEqual(fingerprints, manifest.fingerprints, "STAGING_REPLICA_CHANGED_AFTER_BACKUP");
  return conversionDigest(fingerprints);
}

export function stagingOwnerPolicy(policy) {
  assert.ok(policy?.decision === "allow" && policy.include?.length === 1
    && policy.include[0].cloudflare_account_member?.account_id === STAGING_TARGET.account
    && Object.keys(policy.include[0]).length === 1 && (policy.exclude?.length ?? 0) === 0
    && policy.require?.length > 0 && policy.require.every((rule) => Object.keys(rule).length === 1
      && typeof rule.email?.email === "string" && rule.email.email.includes("@")),
  "STAGING_OWNER_POLICY_INVALID");
  return { decision: "allow", include: policy.include, require: policy.require, exclude: [] };
}

export async function readStagingProviderPrestate() {
  const accessPrefix = `/accounts/${STAGING_TARGET.account}/access`;
  const [zone, organization, idps, oldApp, oldPolicies, apps, dns, project, envs, primaryDomains, targetDomains, auth, secrets] = await Promise.all([
    conversionApi("cloudflare", `/zones/${STAGING_TARGET.zone}`),
    conversionApi("cloudflare", `${accessPrefix}/organizations`),
    conversionApi("cloudflare", `${accessPrefix}/identity_providers?per_page=1000`),
    conversionApi("cloudflare", `${accessPrefix}/apps/${STAGING_TARGET.oldAccessId}`),
    conversionApi("cloudflare", `${accessPrefix}/apps/${STAGING_TARGET.oldAccessId}/policies`),
    conversionApi("cloudflare", `${accessPrefix}/apps?per_page=1000`),
    conversionApi("cloudflare", `/zones/${STAGING_TARGET.zone}/dns_records?name=${STAGING_TARGET.host}`),
    conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}`),
    conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}/env`),
    conversionApi("vercel", `/v9/projects/${STAGING_TARGET.primaryProject}/domains?limit=100`),
    conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}/domains?limit=100`),
    conversionApi("supabase", `/v1/projects/${STAGING_TARGET.ref}/config/auth`),
    conversionApi("supabase", `/v1/projects/${STAGING_TARGET.ref}/secrets`),
  ]);
  assert.ok(zone.id === STAGING_TARGET.zone && zone.name === "qidaigo.com"
    && zone.account?.id === STAGING_TARGET.account, "STAGING_ZONE_INVALID");
  assert.ok(project.id === STAGING_TARGET.project && project.accountId === STAGING_TARGET.team
    && project.ssoProtection?.deploymentType === "all_except_custom_domains", "STAGING_VERCEL_PROJECT_INVALID");
  // The old project has only deployment-injected settings. Never inherit another
  // workspace's later settings or silently replace a concurrently attached domain.
  assert.ok(Array.isArray(envs.envs) && envs.envs.length === 0 && !envs.pagination?.next
    && !primaryDomains.pagination?.next && !targetDomains.pagination?.next
    && !primaryDomains.domains.some((domain) => domain.name === STAGING_TARGET.host), "STAGING_PROJECT_PRESTATE_CHANGED");
  assert.ok(Array.isArray(apps) && apps.length < 1000 && Array.isArray(dns) && dns.length === 0
    && !apps.some((app) => app.domain === STAGING_TARGET.host)
    && !targetDomains.domains.some((domain) => domain.name === STAGING_TARGET.host), "STAGING_ENTRY_ALREADY_EXISTS");
  assert.ok(oldApp.domain === "dr.qidaigo.com" && oldApp.type === "self_hosted"
    && oldApp.allowed_idps?.length === 1 && oldPolicies.length === 1, "STAGING_OLD_ACCESS_CHANGED");
  const idp = idps.find((item) => item.id === oldApp.allowed_idps[0]);
  assert.ok(idp?.type === "cloudflare" && idp.config?.restrict_to_account_members === true, "STAGING_IDP_INVALID");
  const authDomain = organization.auth_domain?.replace(/^https:\/\//, "").replace(/\/$/, "");
  assert.match(authDomain, /^[a-z0-9-]+\.cloudflareaccess\.com$/);
  const retiredAliases = [];
  for (const host of RETIRED_HOSTS) {
    const alias = await conversionApi("vercel", `/v4/aliases/${host}`);
    const deployment = await conversionApi("vercel", `/v13/deployments/${alias.deploymentId}`);
    assert.ok(alias.projectId === STAGING_TARGET.project && deployment.projectId === STAGING_TARGET.project
      && deployment.readyState === "READY", "STAGING_RETIRED_ALIAS_CHANGED");
    retiredAliases.push({ host, aliasId: alias.uid ?? alias.id, deploymentId: deployment.id, deploymentUrl: deployment.url });
  }
  return { projectId: project.id, protection: project.ssoProtection.deploymentType,
    targetDomainDigest: conversionDigest(targetDomains.domains),
    sourceAccessId: oldApp.id, sourcePolicyId: oldPolicies[0].id,
    sourcePolicyDigest: conversionDigest(stagingOwnerPolicy(oldPolicies[0])),
    idpId: idp.id, teamDomain: `https://${authDomain}`, stagingEntryAbsent: true,
    authDigest: conversionDigest(auth), edgeSecretsDigest: conversionDigest(secrets), retiredAliases };
}

export async function readApprovedConversionPlan(backup) {
  const plan = JSON.parse(await readFile("approved-transition-plan/dr-staging-transition-plan.json", "utf8"));
  assert.equal(plan.schemaVersion, 1, "STAGING_PLAN_INVALID");
  assert.equal(plan.sourceSha, conversionRequired("GITHUB_SHA"), "STAGING_SOURCE_CHANGED");
  assert.deepEqual(plan.target, STAGING_TARGET, "STAGING_PLAN_TARGET_CHANGED");
  assert.deepEqual(plan.backup, backup.identity, "STAGING_BACKUP_CHANGED");
  return plan;
}

async function main() {
  requireConversionInvocation();
  const command = process.argv[2];
  assert.ok(["plan", "parameters", "verify", "diagnose-sources"].includes(command), "STAGING_PLAN_COMMAND_INVALID");
  if (command === "diagnose-sources") {
    await diagnoseConversionSourceChecks();
    return;
  }
  const backup = await readConversionBackup();
  console.log("PASS: qualified encrypted backup, restore proof and unchanged reset inputs.");
  let plan;
  if (command === "plan") {
    const sourceChecks = await verifyConversionSourceChecks();
    console.log("PASS: exact main/staging source checks.");
    const primary = await readConversionPrimary();
    console.log("PASS: Primary isolation and live baseline.");
    const replicaDigest = await verifyOriginalReplica(backup.manifest);
    console.log("PASS: original replica matches the qualified backup.");
    const providerPrestate = await readStagingProviderPrestate();
    console.log("PASS: current Cloudflare and target provider prestate.");
    plan = { schemaVersion: 1, sourceSha: conversionRequired("GITHUB_SHA"), target: STAGING_TARGET,
      backup: backup.identity, migrationCount: backup.migrationCount, sourceChecks, primary, replicaDigest, providerPrestate };
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/dr-staging-transition-plan.json", JSON.stringify(plan, null, 2) + "\n");
  } else {
    plan = await readApprovedConversionPlan(backup);
    if (command === "verify") {
      assert.deepEqual(await readConversionPrimary(), plan.primary, "STAGING_PRIMARY_CHANGED");
      assert.equal(await verifyOriginalReplica(backup.manifest), plan.replicaDigest, "STAGING_REPLICA_CHANGED");
      assert.deepEqual(await readStagingProviderPrestate(), plan.providerPrestate, "STAGING_PROVIDER_PRESTATE_CHANGED");
    }
  }
  await appendFile(conversionRequired("GITHUB_ENV"), `STAGING_APPROVAL_PARAMETERS=${JSON.stringify({
    targetRef: STAGING_TARGET.ref, backupRunId: backup.identity.runId,
    transitionSnapshotSha256: conversionDigest(plan), primaryWrites: false,
  })}\n`);
  console.log("PASS: DR-to-Staging Plan evidence checked; no hosted writes performed.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(/^STAGING_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "STAGING_PLAN_FAILED");
    process.exitCode = 1;
  });
}
