import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeProtectedSecret } from "./lib/protected-secret.mjs";

const PROJECT = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP";
const TEAM = "team_MMfsiG94K9Zy3e6w7Ccc9xY4";
const HOST = "app.qidaigo.com";
export const RETIRED_DR_KEYS = Object.freeze([
  "DR_SUPABASE_URL", "DR_SUPABASE_SECRET_KEY", "DR_DIRECT_URL",
  "DR_DATABASE_URL", "DR_REPLICATION_SUBSCRIPTION_NAME",
]);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function metadata(entry) {
  return { id: entry.id, key: entry.key, target: entry.target,
    type: entry.type, updatedAt: entry.updatedAt ?? null };
}

export function selectRetirementBindings(entries) {
  return entries.filter((entry) => entry.key?.startsWith("DR_")
    && entry.target?.includes("production")).map((entry) => {
    assert.ok(RETIRED_DR_KEYS.includes(entry.key)
      && /^[A-Za-z0-9_-]+$/.test(entry.id) && !entry.gitBranch
      && entry.target.length === 1, "DR_RUNTIME_BINDING_SCOPE_INVALID");
    return metadata(entry);
  }).sort((a, b) => a.key.localeCompare(b.key));
}

export function retirementParameters(snapshot) {
  return { databaseChanges: false, edgeFunctionChanges: false,
    retireDrRuntime: true, retirementSnapshotSha256: digest(snapshot) };
}

export function assertRetirementDeployment(deployment, alias, sha, expectedUrl) {
  assert.ok(deployment.projectId === PROJECT && deployment.target === "production"
    && deployment.readyState === "READY" && alias.projectId === PROJECT
    && alias.deploymentId === deployment.id && `https://${deployment.url}` === expectedUrl
    && deployment.meta?.git_commit === sha && deployment.meta?.dr_runtime_retired === "true",
  "DR_RUNTIME_PROMOTED_ARTIFACT_MISMATCH");
}

async function main() {
  assert.ok(process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform"
    && process.env.GITHUB_REF === "refs/heads/main"
    && process.env.GITHUB_ACTOR === "KenLeeYa"
    && process.env.VERCEL_PROJECT_ID === PROJECT && process.env.VERCEL_ORG_ID === TEAM,
  "DR_RUNTIME_INVOCATION_INVALID");
  const command = process.argv[2];
  assert.ok(["plan", "parameters", "verify", "retire"].includes(command), "DR_RUNTIME_COMMAND_INVALID");
  const planPath = command === "plan" ? "artifacts/primary-dr-runtime-plan.json"
    : "approved-application-plan/primary-dr-runtime-plan.json";
  let snapshot;
  if (command === "plan") {
    const state = await readState();
    snapshot = { schemaVersion: 1, sourceSha: required("GITHUB_SHA"), ...state };
    await mkdir("artifacts", { recursive: true });
    await writeFile(planPath, JSON.stringify(snapshot, null, 2) + "\n");
  } else {
    snapshot = JSON.parse(await readFile(planPath, "utf8"));
    assert.equal(snapshot.schemaVersion, 1, "DR_RUNTIME_PLAN_INVALID");
    assert.equal(snapshot.sourceSha, required("GITHUB_SHA"), "DR_RUNTIME_SOURCE_CHANGED");
  }
  if (["plan", "parameters"].includes(command)) {
    await appendFile(required("GITHUB_ENV"),
      `APPLICATION_APPROVAL_PARAMETERS=${JSON.stringify(retirementParameters(snapshot))}\n`);
    console.log("DR runtime retirement parameters bound to the immutable snapshot.");
    return;
  }
  if (command === "verify") {
    const expected = { ...snapshot };
    delete expected.schemaVersion;
    delete expected.sourceSha;
    assert.deepEqual(await readState(), expected, "DR_RUNTIME_PRESTATE_CHANGED");
    assert.match(snapshot.deploymentUrl, /^[a-zA-Z0-9-]+\.vercel\.app$/);
    await appendFile(required("GITHUB_ENV"),
      `RETIREMENT_RECOVERY_DEPLOYMENT=https://${snapshot.deploymentUrl}\n`);
    console.log("Primary baseline and exact Production-only bindings verified; no changes made.");
    return;
  }

  let expectedBindings = snapshot.bindings;
  for (const binding of snapshot.bindings) {
    await assertPromotedState(snapshot, expectedBindings);
    await vercel(`/v9/projects/${PROJECT}/env/${binding.id}`, "DELETE");
    expectedBindings = expectedBindings.filter((entry) => entry.id !== binding.id);
  }
  await assertPromotedState(snapshot, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/primary-dr-runtime-retirement.json", JSON.stringify({
    sourceSha: required("GITHUB_SHA"), deployment: required("APPROVED_PRODUCTION_DEPLOYMENT"),
    removedBindings: snapshot.bindings.map(({ id, key }) => ({ id, key })),
    unrelatedBindingsUnchanged: true, databaseWrites: false,
    oldRecoveryArtifactMustNotBeUsedAfterDrDataCleanup: true,
  }, null, 2) + "\n");
  console.log("PASS: verified Primary-only artifact; retired only its planned DR bindings.");
}

async function assertPromotedState(snapshot, expectedBindings) {
  const state = await readState();
  const [deployment, alias] = await Promise.all([
    vercel(`/v13/deployments/${HOST}`), vercel(`/v4/aliases/${HOST}`),
  ]);
  assertRetirementDeployment(deployment, alias, required("GITHUB_SHA"),
    required("APPROVED_PRODUCTION_DEPLOYMENT"));
  assert.equal(state.revision, required("GITHUB_SHA"), "DR_RUNTIME_LIVE_REVISION_MISMATCH");
  assert.equal(state.promotionEpoch, snapshot.promotionEpoch, "DR_RUNTIME_WRITER_EPOCH_CHANGED");
  assert.deepEqual(state.bindings, expectedBindings, "DR_RUNTIME_BINDINGS_CHANGED");
  assert.equal(state.otherBindingsDigest, snapshot.otherBindingsDigest, "DR_RUNTIME_OTHER_BINDINGS_CHANGED");
}

async function readState() {
  const [deployment, alias, environment, version, health, login, availability] = await Promise.all([
    vercel(`/v13/deployments/${HOST}`), vercel(`/v4/aliases/${HOST}`),
    vercel(`/v9/projects/${PROJECT}/env`),
    publicGet("/api/version"), publicGet("/api/connectivity"), publicGet("/login"),
    publicGet("/api/availability/config"),
  ]);
  assert.ok(deployment.projectId === PROJECT && deployment.target === "production"
    && deployment.readyState === "READY" && alias.projectId === PROJECT
    && alias.deploymentId === deployment.id, "DR_RUNTIME_PRIMARY_IDENTITY_MISMATCH");
  assert.equal(health.status, 200, "DR_RUNTIME_PRIMARY_UNHEALTHY");
  assert.equal(login.status, 200, "DR_RUNTIME_LOGIN_UNAVAILABLE");
  assert.equal(version.status, 200, "DR_RUNTIME_VERSION_UNAVAILABLE");
  assert.equal(availability.status, 200, "DR_RUNTIME_AVAILABILITY_UNAVAILABLE");
  const availabilityConfig = await availability.json();
  assert.ok(availabilityConfig.mode === "NORMAL_PRIMARY" && availabilityConfig.activeBackend === "PRIMARY"
    && Number.isSafeInteger(availabilityConfig.promotionEpoch), "DR_RUNTIME_WRITER_CHANGED");
  await Promise.all([health.arrayBuffer(), login.arrayBuffer()]);
  const { revision } = await version.json();
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.equal(revision, deployment.meta?.git_commit ?? deployment.meta?.githubCommitSha,
    "DR_RUNTIME_BASELINE_REVISION_MISMATCH");
  assert.ok(Array.isArray(environment.envs) && !environment.pagination?.next,
    "DR_RUNTIME_ENVIRONMENT_INCOMPLETE");
  const bindings = selectRetirementBindings(environment.envs);
  const ownedIds = new Set(bindings.map((entry) => entry.id));
  return { deploymentId: deployment.id, deploymentUrl: deployment.url, revision, bindings,
    promotionEpoch: availabilityConfig.promotionEpoch,
    otherBindingsDigest: digest(environment.envs.filter((entry) => !ownedIds.has(entry.id))
      .map(metadata).sort((a, b) => a.id.localeCompare(b.id))) };
}

async function publicGet(path) {
  return fetch(`https://${HOST}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
}

async function vercel(path, method = "GET") {
  const { value } = normalizeProtectedSecret(required("VERCEL_TOKEN"), "VERCEL_TOKEN");
  const response = await fetch(`https://api.vercel.com${path}?teamId=${TEAM}`, {
    method, headers: { Authorization: `Bearer ${value}` },
    redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, "DR_RUNTIME_PROVIDER_REQUEST_FAILED");
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, "DR_RUNTIME_CONFIGURATION_MISSING");
  return value;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(/^DR_RUNTIME_[A-Z_]+$/.test(error?.message ?? "")
      ? error.message : "DR_RUNTIME_RETIREMENT_FAILED");
    process.exitCode = 1;
  });
}
