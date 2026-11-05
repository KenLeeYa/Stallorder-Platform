import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureApplicationBaseline, readApplicationRuntime, assertApplicationPrimary } from "./production-application-target.mjs";
import { normalizeProtectedSecret } from "./lib/protected-secret.mjs";

// This one recovery artifact was qualified by the original successful protected retirement Apply.
// A different artifact requires source review, not caller-supplied "qualified" metadata.
export const RECOVERY = Object.freeze({
  id: "dpl_4v5acoGZU8tkbTAnb6uEwuN5AjJQ", sha: "4e95d2ea5d53ae78c5af9c3db044481237674c44",
  url: "stallorder-platform-3mmwpt7bl-ada76145-8663s-projects.vercel.app",
  archiveSha256: "b5733866a393f483a2fc5fea36c78a861d932c87d98320232f33c23674c027b0",
  createdAt: 1792607340894,
  envNamesSha256: "143816fb80ca5687ab70eb2919d9487ca8b474806b5c56468be1cdec56494bb2",
});
const PROJECT = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", TEAM = "team_MMfsiG94K9Zy3e6w7Ccc9xY4";
const HOST = "app.qidaigo.com", BACKEND = "eyuctbnlvnbnivwasvqr";
const RUN = 39652990080, ARTIFACT = 12369384806, REPOSITORY = "KenLeeYa/Stallorder-Platform";
const digest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const fail = code => { throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const REQUIRED_BINDINGS = ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
const OPTIONAL_BINDINGS = ["SUPABASE_FUNCTIONS_URL", "NEXT_PUBLIC_SUPABASE_REALTIME_URL", "PRIMARY_SUPABASE_URL", "PRIMARY_SUPABASE_SECRET_KEY", "PRIMARY_SUPABASE_SERVICE_ROLE_KEY", "BACKEND_ACTIVE_TARGET", "PROMOTION_EPOCH", "PUBLIC_ORDER_FUNCTION_ORIGIN", "NEXT_PUBLIC_APP_URL", "AUTH_PROJECT_CODE"];
// URL/key selectors and their consumers must remain byte-identical to the qualified artifact.
const SOURCE_SCOPES = ["prisma", "supabase", "src/server/resilience", "src/lib/database-connection-profile.ts",
  "src/lib/prisma.ts", "src/lib/supabase-auth.ts", "src/lib/supabase-browser.ts", "src/lib/public-order-client.ts", "src/lib/product-image-url.ts",
  "src/server/public-order/canonical-tracking-validator.ts", "src/app/api/public-order/[functionName]/route.ts",
  "src/app/api/assets/offline-menus/[...objectPath]/route.ts", "src/app/api/assets/product-images/[...objectPath]/route.ts",
  "src/app/api/merchant/organizations/[organizationId]/catalog/image/route.ts", "src/app/api/merchant/stalls/[stallId]/alert-sound/route.ts",
  "src/app/api/merchant/stalls/[stallId]/cover-image/route.ts", "src/app/api/stalls/[stallSlug]/alert-sound/route.ts",
  "next.config.ts", "vercel.json", "src/server/database/read-router.ts", "src/app/auth/callback/route.ts", "src/server/auth/oauth/login-method-availability.ts"];

export function verifyRecoveryProvenance({ run, artifact, bytes }) {
  if (run?.id !== RUN || run.run_attempt !== 1 || run.status !== "completed" || run.conclusion !== "success"
    || run.event !== "workflow_dispatch" || run.head_branch !== "main" || run.head_sha !== RECOVERY.sha
    || run.path !== ".github/workflows/production-application-release.yml" || run.actor?.login !== "KenLeeYa"
    || run.triggering_actor?.login !== "KenLeeYa" || run.repository?.full_name !== REPOSITORY
    || artifact?.id !== ARTIFACT || artifact.name !== `production-application-${RUN}` || artifact.expired !== false
    || artifact.size_in_bytes !== 1053 || artifact.digest !== `sha256:${RECOVERY.archiveSha256}`
    || artifact.workflow_run?.id !== RUN || artifact.workflow_run.head_sha !== RECOVERY.sha
    || !Buffer.isBuffer(bytes) || bytes.length !== 1053 || digest(bytes) !== RECOVERY.archiveSha256) fail("RELEASE_RECOVERY_PROVENANCE_INVALID");
  return { ...RECOVERY };
}

export function configurationDigest(response) {
  if (!Array.isArray(response?.envs) || response.pagination?.next) fail("RELEASE_CONFIG_INCOMPLETE");
  if (response.envs.some(entry => !Array.isArray(entry.target))) fail("RELEASE_CONFIG_INCOMPLETE");
  const rows = response.envs.filter(entry => entry.target.includes("production"));
  if (rows.some(entry => !entry.id || !entry.key || !entry.type || entry.updatedAt == null || entry.key.startsWith("DR_"))
    || new Set(rows.map(entry => entry.id)).size !== rows.length) fail("RELEASE_CONFIG_INVALID");
  return digest(rows.map(({ id, key, target, type, createdAt, updatedAt, gitBranch, customEnvironmentIds, configurationId }) => ({
    id, key, target: [...target].sort(), type, createdAt, updatedAt, gitBranch: gitBranch ?? null,
    customEnvironmentIds: [...(customEnvironmentIds ?? [])].sort(), configurationId: configurationId ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

export function recoveryPlanParameters(snapshot) {
  return { databaseChanges: false, edgeFunctionChanges: false, recoverySnapshotSha256: digest(snapshot) };
}

export function assertRecoveryPlan(snapshot, sourceSha) {
  if (snapshot?.schemaVersion !== 1 || !/^[a-f0-9]{40}$/u.test(sourceSha ?? "") || snapshot.sourceSha !== sourceSha
    || snapshot.projectId !== PROJECT || snapshot.teamId !== TEAM || snapshot.hostname !== HOST || snapshot.backendRef !== BACKEND
    || !Number.isSafeInteger(snapshot.promotionEpoch) || snapshot.promotionEpoch < 1
    || !/^[a-f0-9]{64}$/u.test(snapshot.configurationSha256 ?? "") || !same(snapshot.recovery, RECOVERY)
    || !/^dpl_[A-Za-z0-9]+$/u.test(snapshot.baseline?.deploymentId ?? "")
    || !/^[a-f0-9]{40}$/u.test(snapshot.baseline.sha ?? "")
    || snapshot.baseline?.recovery?.deploymentId !== RECOVERY.id || snapshot.baseline.recovery.sha !== RECOVERY.sha
    || snapshot.baseline.recovery.url !== RECOVERY.url) fail("RELEASE_PLAN_INVALID");
}

export function expectedFromPlan(snapshot, env) {
  return { ...env, STALLORDER_RESILIENCE_MODE: "PRIMARY_ONLY", RELEASE_PROMOTION_EPOCH: String(snapshot.promotionEpoch),
    RELEASE_PRIMARY_DEPLOYMENT_ID: snapshot.baseline.deploymentId, RELEASE_PRIMARY_SHA: snapshot.baseline.sha,
    RELEASE_HEALTHY_DEPLOYMENT_ID: RECOVERY.id, RELEASE_HEALTHY_SHA: RECOVERY.sha };
}

export async function readConfiguration(api) {
  const environment = await api(`/v9/projects/${PROJECT}/env?teamId=${TEAM}`);
  const environmentSha256 = configurationDigest(environment);
  const deployment = await api(`/v13/deployments/${RECOVERY.id}?teamId=${TEAM}`);
  if (deployment.id !== RECOVERY.id || deployment.projectId !== PROJECT || deployment.url !== RECOVERY.url
    || deployment.target !== "production" || deployment.readyState !== "READY" || deployment.createdAt !== RECOVERY.createdAt
    || deployment.meta?.githubCommitSha !== RECOVERY.sha || (deployment.meta.git_commit && deployment.meta.git_commit !== RECOVERY.sha)
    || !Array.isArray(deployment.env) || deployment.env.some(key => typeof key !== "string")
    || new Set(deployment.env).size !== deployment.env.length || digest([...deployment.env].sort()) !== RECOVERY.envNamesSha256) fail("RELEASE_CONFIG_RECOVERY_INVALID");
  // Provider metadata versions establish inheritance from the qualified artifact, not decrypted equality.
  // Historical DR names are pinned too: the qualified retirement CLI explicitly overrode them empty.
  const bindings = [...REQUIRED_BINDINGS, ...OPTIONAL_BINDINGS].map(key => {
    const inherited = deployment.env.includes(key);
    const rows = environment.envs.filter(row => row.key === key && row.target.includes("production"));
    if (!inherited && !rows.length && !REQUIRED_BINDINGS.includes(key)) return { key, state: "absent" };
    if (!inherited || rows.length !== 1) fail("RELEASE_CONFIG_LINEAGE_UNPROVEN");
    const row = rows[0];
    if (row.target.length !== 1 || row.gitBranch != null || row.configurationId != null
      || (row.customEnvironmentIds != null && (!Array.isArray(row.customEnvironmentIds) || row.customEnvironmentIds.length))
      || !["plain", "encrypted", "sensitive"].includes(row.type)
      || !Number.isSafeInteger(row.createdAt) || row.createdAt < 1 || !Number.isSafeInteger(row.updatedAt)
      || row.updatedAt < row.createdAt || row.updatedAt > deployment.createdAt) fail("RELEASE_CONFIG_LINEAGE_UNPROVEN");
    return { key, state: "inherited", id: row.id, type: row.type, createdAt: row.createdAt, updatedAt: row.updatedAt };
  });
  const project = await api(`/v9/projects/${PROJECT}?teamId=${TEAM}`);
  const historical = deployment.projectSettings;
  if (project.id !== PROJECT || project.accountId !== TEAM || !historical
    || project.rootDirectory !== null || typeof project.sourceFilesOutsideRootDirectory !== "boolean"
    || project.commandForIgnoringBuildStep != null || historical.commandForIgnoringBuildStep != null
    || project.framework !== "nextjs" || historical.framework !== "nextjs"
    || project.nodeVersion !== "24.x" || historical.nodeVersion !== "24.x"
    || ["buildCommand", "installCommand", "devCommand", "outputDirectory"].some(key => project[key] !== null || historical[key] !== null)) fail("RELEASE_CONFIG_BUILD_SETTINGS_UNPROVEN");
  // Historical root/outside-root fields were not exposed. Bind the current repo-root build
  // settings without inventing historical equality; recovery uses the fixed immutable artifact.
  const buildSettings = { buildCommand: null, installCommand: null, devCommand: null, outputDirectory: null,
    framework: "nextjs", nodeVersion: "24.x", current: { rootDirectory: project.rootDirectory,
      sourceFilesOutsideRootDirectory: project.sourceFilesOutsideRootDirectory,
      ignoreCommandPresent: Object.hasOwn(project, "commandForIgnoringBuildStep") },
    historicalIgnoreCommandPresent: Object.hasOwn(historical, "commandForIgnoringBuildStep") };
  const configurationLineage = { basis: "qualified-deployment-inheritance", recoveryDeploymentId: RECOVERY.id,
    createdAt: deployment.createdAt, envNamesSha256: RECOVERY.envNamesSha256, bindings, buildSettings };
  return { configurationSha256: digest({ environmentSha256, configurationLineage }), backendRef: BACKEND, configurationLineage };
}

async function main() {
  const env = process.env, mode = process.argv[2];
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_ACTOR !== "KenLeeYa" || !["plan", "parameters", "verify", "verify-recovery"].includes(mode)) fail("RELEASE_PLAN_INVOCATION_INVALID");
  assertApplicationPrimary(env);
  const path = mode === "plan" ? "artifacts/production-application-recovery-plan.json" : "approved-application-plan/production-application-recovery-plan.json";
  let snapshot = mode === "plan" ? null : JSON.parse(readFileSync(path, "utf8"));
  if (snapshot) assertRecoveryPlan(snapshot, env.GITHUB_SHA);
  if (mode !== "parameters") {
    const vercelToken = normalizeProtectedSecret(env.VERCEL_TOKEN, "VERCEL_TOKEN").value;
    if (!env.GITHUB_TOKEN) fail("RELEASE_PROVENANCE_TOKEN_REQUIRED");
    const read = async (url, token, archive = false) => {
      let response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "cache-control": "no-cache", accept: "application/vnd.github+json" },
        redirect: archive ? "manual" : "error", signal: AbortSignal.timeout(30000) });
      if (archive && response.status === 302) {
        const target = new URL(response.headers.get("location") ?? "");
        if (target.protocol !== "https:" || target.username || target.password || target.port
          || !target.hostname.endsWith(".blob.core.windows.net")) fail("RELEASE_ARCHIVE_REDIRECT_INVALID");
        // One signed artifact redirect, without forwarding the GitHub credential.
        response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(30000) });
      }
      if (!response.ok) fail("RELEASE_PROVIDER_READ_FAILED");
      if (!archive) return response.json();
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1053) fail("RELEASE_RECOVERY_PROVENANCE_INVALID");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    };
    const gh = `https://api.github.com/repos/${REPOSITORY}/actions`;
    const run = await read(`${gh}/runs/${RUN}`, env.GITHUB_TOKEN);
    const artifact = await read(`${gh}/artifacts/${ARTIFACT}`, env.GITHUB_TOKEN);
    const bytes = await read(`${gh}/artifacts/${ARTIFACT}/zip`, env.GITHUB_TOKEN, true);
    verifyRecoveryProvenance({ run, artifact, bytes });
    // The app-only recovery must have exactly the same database/schema/Edge/resilience contracts.
    try {
      execFileSync("git", ["diff", "--quiet", RECOVERY.sha, env.GITHUB_SHA, "--", ...SOURCE_SCOPES.map(path => `:(literal)${path}`)], { stdio: "pipe", timeout: 15000,
        env: { PATH: env.PATH, ...(env.SystemRoot ? { SystemRoot: env.SystemRoot } : {}) } });
    } catch { fail("RELEASE_RECOVERY_SOURCE_INCOMPATIBLE"); }
    const api = p => read(`https://api.vercel.com${p}`, vercelToken);
    const config = await readConfiguration(api);
    const runtime = origin => readApplicationRuntime(origin, env);
    if (!snapshot) {
      const owner = await api(`/v9/projects/${PROJECT}?teamId=${TEAM}`);
      if (owner.id !== PROJECT || owner.accountId !== TEAM) fail("RELEASE_PROJECT_DRIFT");
      const activeId = owner.targets?.production?.id;
      if (!/^dpl_[A-Za-z0-9]+$/u.test(activeId ?? "")) fail("RELEASE_PRIMARY_CHANGED");
      const deployment = await api(`/v13/deployments/${activeId}?teamId=${TEAM}`);
      const live = await runtime(`https://${HOST}`);
      snapshot = { schemaVersion: 1, sourceSha: env.GITHUB_SHA, projectId: PROJECT, teamId: TEAM, hostname: HOST,
        recovery: { ...RECOVERY }, ...config, promotionEpoch: live.availability.promotionEpoch,
        baseline: { deploymentId: activeId, sha: deployment.meta?.githubCommitSha ?? deployment.meta?.git_commit } };
    }
    if (!same(config, { configurationSha256: snapshot.configurationSha256, backendRef: snapshot.backendRef,
      configurationLineage: snapshot.configurationLineage })) fail("RELEASE_CONFIG_CHANGED");
    const current = mode === "verify-recovery" ? snapshot.baseline
      : await captureApplicationBaseline(expectedFromPlan(snapshot, env), api, runtime);
    if (current.recovery.url !== RECOVERY.url) fail("RELEASE_RECOVERY_DRIFT");
    if (mode === "verify") {
      const stable = value => { const copy = structuredClone(value); delete copy.checkedAt; return copy; };
      if (!same(stable(current), stable(snapshot.baseline))) fail("RELEASE_BASELINE_CHANGED");
    } else snapshot.baseline = current;
    if (!same(await readConfiguration(api), config)) fail("RELEASE_CONFIG_CHANGED");
    assertRecoveryPlan(snapshot, env.GITHUB_SHA);
    if (mode === "plan") {
      mkdirSync("artifacts", { recursive: true });
      writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
    }
  }
  if (!env.GITHUB_ENV) fail("RELEASE_ENV_OUTPUT_REQUIRED");
  const expected = expectedFromPlan(snapshot, env);
  appendFileSync(env.GITHUB_ENV, `APPLICATION_APPROVAL_PARAMETERS=${JSON.stringify(recoveryPlanParameters(snapshot))}\n`
    + ["RELEASE_PROMOTION_EPOCH", "RELEASE_PRIMARY_DEPLOYMENT_ID", "RELEASE_PRIMARY_SHA",
      "RELEASE_HEALTHY_DEPLOYMENT_ID", "RELEASE_HEALTHY_SHA", "STALLORDER_RESILIENCE_MODE"]
      .map(key => `${key}=${expected[key]}\n`).join("")
    + `RELEASE_ROLLBACK_DEPLOYMENT=${RECOVERY.id}\n`);
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/production-application-baseline.json", `${JSON.stringify(snapshot.baseline, null, 2)}\n`);
  console.log(`Verified application recovery ${mode}; no provider writes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(/^RELEASE_[A-Z_]+$/u.test(error?.message) ? error.message : "RELEASE_RECOVERY_PLAN_FAILED"); process.exitCode = 1; });
}
