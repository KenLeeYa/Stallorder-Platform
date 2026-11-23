import { originReceiptBase64 } from "./production-application-origin-receipt.mjs";
import assert from "node:assert/strict";
import { test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RECOVERY, verifyRecoveryProvenance, recoveryPlanParameters, assertRecoveryPlan, assertPlanPrimary, configurationDigest, readConfiguration } from "../production-application-recovery-plan.mjs";

test("requires the exact settled Vercel job for the current Primary deployment", () => {
  const deployment = {
    id: "dpl_3quCAGsiYikcNsMPc7zPGyFc64dz", projectId: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP",
    ownerId: "team_MMfsiG94K9Zy3e6w7Ccc9xY4", target: "production", readyState: "READY", source: "cli",
    meta: { githubCommitSha: "b203d3cd6de8a3b4026f815fd297a00bb2204dda",
      git_commit: "b203d3cd6de8a3b4026f815fd297a00bb2204dda",
      approval_plan_run_id: "45118796489", release_mode: "application_only" },
  };
  const job = { type: "promote", jobStatus: "succeeded", toDeploymentId: deployment.id, requestedAt: 1795414085368 };
  const owner = { targets: { production: { id: deployment.id } }, lastAliasRequest: job };
  assert.doesNotThrow(() => assertPlanPrimary(owner, deployment));
  for (const bad of [undefined, { ...job, jobStatus: "pending" }, { ...job, requestedAt: job.requestedAt + 1 }]) {
    assert.throws(() => assertPlanPrimary({ ...owner, lastAliasRequest: bad }, deployment), /RELEASE_PRIMARY_CHANGED/);
  }
  assert.throws(() => assertPlanPrimary(owner, { ...deployment, meta: { ...deployment.meta, git_commit: "other" } }),
    /RELEASE_PRIMARY_CHANGED/);
});

// Exact public historical artifact bytes, fixture-only; not a substitute for live provenance readback.
const bytes = Buffer.from(originReceiptBase64, "base64");
const RECOVERY_CREATED_AT = 1794833467254;
const RECOVERY_ENV_NAMES = ["AI_TRANSLATION_PROVIDER","ALLOW_DEMO_SEED","AUDIT_IP_HASH_SECRET","AUTH_PROJECT_CODE","AZURE_TRANSLATOR_KEY","AZURE_TRANSLATOR_REGION","BACKEND_ACTIVE_TARGET","CATALOG_TRANSLATION_ENABLED","CRON_API_SECRET","CRON_SECRET","DATABASE_URL","DIRECT_URL","GOOGLE_MAPS_EMBED_API_KEY","LINE_CHANNEL_ID","LINE_CHANNEL_SECRET","LINE_REDIRECT_URI","LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT","NEXT_DEPLOYMENT_ID","NEXT_PUBLIC_APP_URL","NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED","NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_TURNSTILE_SITE_KEY","NX_DAEMON","OAUTH_STATE_SECRET","OPENAI_API_KEY","OPENAI_TRANSLATION_ENABLED","OPENAI_TRANSLATION_MODEL","PRIMARY_SUPABASE_SECRET_KEY","PRIMARY_SUPABASE_URL","PROMOTION_EPOCH","REPORT_DELIVERY_MODE","SUPABASE_SECRET_KEY","TRUSTED_CLIENT_IP_HEADER","TURBO_CACHE","TURBO_DOWNLOAD_LOCAL_ENABLED","TURBO_PLATFORM_ENV","TURBO_REMOTE_ONLY","TURBO_RUN_SUMMARY","VERCEL","VERCEL_AUTOMATION_BYPASS_SECRET","VERCEL_CACHE_HANDLER_MEMORY_CACHE","VERCEL_CONNECT_GUARD","VERCEL_DEPLOYMENT_ID","VERCEL_DEPLOYMENT_KEY","VERCEL_ENV","VERCEL_FLUID","VERCEL_GIT_COMMIT_AUTHOR_LOGIN","VERCEL_GIT_COMMIT_AUTHOR_NAME","VERCEL_GIT_COMMIT_MESSAGE","VERCEL_GIT_COMMIT_REF","VERCEL_GIT_COMMIT_SHA","VERCEL_GIT_PREVIOUS_SHA","VERCEL_GIT_PROVIDER","VERCEL_GIT_PULL_REQUEST_ID","VERCEL_GIT_REPO_ID","VERCEL_GIT_REPO_OWNER","VERCEL_GIT_REPO_SLUG","VERCEL_PROJECT_ID","VERCEL_PROJECT_NAME","VERCEL_PROJECT_PRODUCTION_URL","VERCEL_SKEW_PROTECTION_ENABLED","VERCEL_TARGET_ENV","VERCEL_URL","VERCEL_VDC_REMOTE_CACHE_ENABLED","VERCEL_WEB_ANALYTICS_ID","WEB_PUSH_ENABLED","WEB_PUSH_ENCRYPTION_KEY","WEB_PUSH_VAPID_PRIVATE_KEY","WEB_PUSH_VAPID_PUBLIC_KEY","WEB_PUSH_VAPID_SUBJECT"];
const REQUIRED_ROUTING = ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"];
const OPTIONAL_ROUTING = ["SUPABASE_FUNCTIONS_URL", "NEXT_PUBLIC_SUPABASE_REALTIME_URL", "PRIMARY_SUPABASE_URL", "PRIMARY_SUPABASE_SECRET_KEY", "PRIMARY_SUPABASE_SERVICE_ROLE_KEY", "BACKEND_ACTIVE_TARGET", "PROMOTION_EPOCH", "PUBLIC_ORDER_FUNCTION_ORIGIN", "NEXT_PUBLIC_APP_URL", "AUTH_PROJECT_CODE"];
const SOURCE_SCOPES = ["prisma", "supabase", "src/server/resilience", "src/lib/database-connection-profile.ts", "src/lib/prisma.ts", "src/lib/supabase-auth.ts", "src/lib/supabase-browser.ts", "src/lib/public-order-client.ts", "src/lib/product-image-url.ts", "src/server/public-order/canonical-tracking-validator.ts", "src/app/api/public-order/[functionName]/route.ts", "src/app/api/assets/offline-menus/[...objectPath]/route.ts", "src/app/api/assets/product-images/[...objectPath]/route.ts", "src/app/api/merchant/organizations/[organizationId]/catalog/image/route.ts", "src/app/api/merchant/stalls/[stallId]/alert-sound/route.ts", "src/app/api/merchant/stalls/[stallId]/cover-image/route.ts", "src/app/api/stalls/[stallSlug]/alert-sound/route.ts", "next.config.ts", "vercel.json", "src/server/database/read-router.ts", "src/app/auth/callback/route.ts", "src/server/auth/oauth/login-method-availability.ts"];
function bindingFixture() {
  return [...REQUIRED_ROUTING, ...OPTIONAL_ROUTING].filter(key => RECOVERY_ENV_NAMES.includes(key))
    .map((key, i) => ({ id: `binding${i}`, key, target: ["production"], type: "sensitive", createdAt: 10, updatedAt: 10 }));
}
function recoveryDeployment() {
  return { id: RECOVERY.id, projectId: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", url: RECOVERY.url, target: "production", readyState: "READY",
    createdAt: RECOVERY_CREATED_AT, env: [...RECOVERY_ENV_NAMES], ownerId: "team_MMfsiG94K9Zy3e6w7Ccc9xY4", source: "redeploy",
    meta: { githubCommitSha: RECOVERY.sha, originalDeploymentId: RECOVERY.originalId, approval_plan_run_id: "39647622492", release_mode: "application_only", dr_runtime_retired: "true" },
    projectSettings: { buildCommand: null, installCommand: null, devCommand: null, outputDirectory: null, framework: "nextjs", nodeVersion: "24.x", commandForIgnoringBuildStep: null } };
}
function projectFixture() {
  const settings = { ...recoveryDeployment().projectSettings }; delete settings.commandForIgnoringBuildStep;
  return { ...settings, id: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", accountId: "team_MMfsiG94K9Zy3e6w7Ccc9xY4",
    rootDirectory: null, sourceFilesOutsideRootDirectory: true, targets: { production: { id: RECOVERY.id } } };
}
function provenance() {
  return { run: { id: 39652990080, run_attempt: 1, status: "completed", conclusion: "success", event: "workflow_dispatch",
    head_branch: "main", head_sha: RECOVERY.sha, path: ".github/workflows/production-application-release.yml",
    actor: { login: "KenLeeYa" }, triggering_actor: { login: "KenLeeYa" }, repository: { full_name: "KenLeeYa/Stallorder-Platform" } },
  bytes };
}
test("qualifies the exact real historical receipt bytes and run identity", () => {
  assert.deepEqual(verifyRecoveryProvenance(provenance()), RECOVERY);
});
for (const [name, change] of [
  ["run failure", p => { p.run.conclusion = "failure"; }],
  ["different attempt", p => { p.run.run_attempt = 2; }],
  ["wrong source", p => { p.run.head_sha = "a".repeat(40); }],
  ["wrong workflow", p => { p.run.path = ".github/workflows/ci.yml"; }],
  ["wrong actor", p => { p.run.triggering_actor.login = "other"; }],
  ["tampered archive", p => { p.bytes = Buffer.from(p.bytes); p.bytes[0] ^= 1; }],
]) test(`rejects ${name} without accepting caller supplied qualification`, () => {
  const p = provenance(); change(p); assert.throws(() => verifyRecoveryProvenance(p), /RELEASE_RECOVERY_PROVENANCE/);
});

function snapshot() {
  return { schemaVersion: 1, sourceSha: "a".repeat(40), recovery: RECOVERY,
    projectId: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", teamId: "team_MMfsiG94K9Zy3e6w7Ccc9xY4", hostname: "app.qidaigo.com",
    backendRef: "eyuctbnlvnbnivwasvqr", promotionEpoch: 3, configurationSha256: "b".repeat(64),
    baseline: { deploymentId: RECOVERY.id, sha: RECOVERY.sha, recovery: { deploymentId: RECOVERY.id, sha: RECOVERY.sha, url: RECOVERY.url } } };
}
test("all immutable recovery snapshot fields participate in approval parameters", () => {
  const original = snapshot(), expected = recoveryPlanParameters(original);
  assert.equal(expected.databaseChanges, false); assert.equal(expected.edgeFunctionChanges, false);
  for (const key of ["sourceSha", "backendRef", "promotionEpoch", "configurationSha256", "hostname"]) {
    const changed = structuredClone(original); changed[key] = key === "promotionEpoch" ? 4 : "changed";
    assert.notDeepEqual(recoveryPlanParameters(changed), expected);
  }
});
test("snapshot identity and source cannot be substituted after Plan", () => {
  const original = snapshot(); assert.doesNotThrow(() => assertRecoveryPlan(original, original.sourceSha));
  for (const key of ["projectId", "teamId", "hostname", "backendRef", "sourceSha"]) {
    const changed = structuredClone(original); changed[key] = "other";
    assert.throws(() => assertRecoveryPlan(changed, original.sourceSha), /RELEASE_PLAN/);
  }
  const changed = structuredClone(original); changed.recovery.id = "dpl_other";
  assert.throws(() => assertRecoveryPlan(changed, original.sourceSha), /RELEASE_PLAN/);
});
test("configuration digest binds only metadata and rejects incomplete or reintroduced DR entries", () => {
  const envs = [{ id: "e1", key: "SUPABASE_URL", target: ["production"], type: "encrypted", updatedAt: 1, value: "never-print-private" }];
  assert.equal(configurationDigest({ envs }), configurationDigest({ envs: [{ ...envs[0], value: "another-secret" }] }));
  assert.notEqual(configurationDigest({ envs }), configurationDigest({ envs: [{ ...envs[0], updatedAt: 2 }] }));
  assert.throws(() => configurationDigest({ envs, pagination: { next: "page2" } }), /RELEASE_CONFIG/);
  assert.throws(() => configurationDigest({ envs: [...envs, { ...envs[0], id: "e2", key: "DR_DATABASE_URL" }] }), /RELEASE_CONFIG/);
});

for (const [name, mutate] of [
  ["wrong deployment ID", (env, d) => { d.id = "dpl_other"; }],
  ["different redeploy source", (env, d) => { d.meta.originalDeploymentId = "dpl_other"; }],
  ["wrong deployment source", (env, d) => { d.meta.githubCommitSha = "f".repeat(40); }],
  ["conflicting deployment source", (env, d) => { d.meta.git_commit = "f".repeat(40); }],
  ["wrong deployment URL", (env, d) => { d.url = "other.vercel.app"; }],
  ["wrong deployment project", (env, d) => { d.projectId = "other"; }],
  ["wrong deployment target", (env, d) => { d.target = "preview"; }],
  ["unready deployment", (env, d) => { d.readyState = "ERROR"; }],
  ["wrong deployment timestamp", (env, d) => { d.createdAt++; }],
  ["unknown env-name representation", (env, d) => { d.env = {}; }],
  ["duplicate env name", (env, d) => { d.env.push("DATABASE_URL"); }],
  ["unrecognized immutable env-name set", (env, d) => { d.env.push("UNREVIEWED_NAME"); }],
  ["required key absent in deployment", (env, d) => { d.env = d.env.filter(key => key !== "DATABASE_URL"); }],
  ["required key absent now", env => { env.envs = env.envs.filter(row => row.key !== "DATABASE_URL"); }],
  ...REQUIRED_ROUTING.slice(1).map(key => [`required ${key} absent now`, env => { env.envs = env.envs.filter(row => row.key !== key); }]),
  ...OPTIONAL_ROUTING.filter(key => RECOVERY_ENV_NAMES.includes(key)).map(key => [`inherited ${key} absent now`, env => { env.envs = env.envs.filter(row => row.key !== key); }]),
  ["optional override added now", env => { env.envs.push({ ...env.envs[0], id: "override", key: "SUPABASE_FUNCTIONS_URL" }); }],
  ["duplicate binding", env => { env.envs.push({ ...env.envs[0], id: "duplicate" }); }],
  ["shared scope", env => { env.envs[0].target.push("preview"); }],
  ["branch scope", env => { env.envs[0].gitBranch = "main"; }],
  ["custom scope", env => { env.envs[0].customEnvironmentIds = ["env_other"]; }],
  ["shared configuration", env => { env.envs[0].configurationId = "integration"; }],
  ["reference type", env => { env.envs[0].type = "system"; }],
  ["invalid timestamp", env => { env.envs[0].createdAt = 0; }],
  ["missing timestamp", env => { delete env.envs[0].updatedAt; }],
  ["timestamp reversal", env => { env.envs[0].createdAt = 11; }],
  ["updated after recovery", env => { env.envs[0].updatedAt = RECOVERY_CREATED_AT + 1; }],
  ["incomplete metadata", env => { env.pagination = { next: "page2" }; }],
  ["wrong settings project", (env, d, p) => { p.id = "prj_other"; }],
  ["wrong settings team", (env, d, p) => { p.accountId = "team_other"; }],
  ...["buildCommand", "installCommand", "devCommand", "outputDirectory"].map(key => [`custom ${key}`, (env, d, p) => { p[key] = "unreviewed"; }]),
  ["missing historical command", (env, d) => { delete d.projectSettings.buildCommand; }],
  ["historical custom command", (env, d) => { d.projectSettings.buildCommand = "unreviewed"; }],
  ["framework drift", (env, d, p) => { p.framework = "other"; }],
  ["runtime drift", (env, d, p) => { p.nodeVersion = "22.x"; }],
  ["root drift", (env, d, p) => { p.rootDirectory = "other"; }],
  ["missing root", (env, d, p) => { delete p.rootDirectory; }],
  ["custom ignore build command", (env, d, p) => { p.commandForIgnoringBuildStep = "exit 0"; }],
  ["unknown outside-root setting", (env, d, p) => { delete p.sourceFilesOutsideRootDirectory; }],
]) {
  test(`configuration inheritance rejects ${name} without reading any value`, async () => {
    const environment = { envs: bindingFixture() }, deployment = recoveryDeployment(), project = projectFixture();
    mutate(environment, deployment, project);
    const paths = [], api = async path => {
      paths.push(path);
      if (path.includes("/env?")) return environment;
      if (path.startsWith("/v9/projects/")) return project;
      if (path.startsWith(`/v13/deployments/${RECOVERY.id}?`)) return deployment;
      throw new Error("secret value read attempted");
    };
    await assert.rejects(readConfiguration(api), /RELEASE_CONFIG/);
    assert.ok(paths.length <= 3); assert.ok(paths.every(path => !/\/env\//.test(path)));
  });
}
test("configuration inheritance binds actual versions and explicit optional absence without values", async () => {
  const environment = { envs: bindingFixture() }, deployment = recoveryDeployment(), paths = [];
  for (const entry of environment.envs) Object.defineProperty(entry, "value", { get() { throw new Error("secret was inspected"); } });
  const api = async path => { paths.push(path); return path.includes("/env?") ? environment : path.startsWith("/v9/") ? projectFixture() : deployment; };
  const result = await readConfiguration(api);
  assert.equal(result.backendRef, "eyuctbnlvnbnivwasvqr");
  assert.equal(result.configurationLineage.recoveryDeploymentId, RECOVERY.id);
  assert.equal(result.configurationLineage.createdAt, RECOVERY_CREATED_AT);
  assert.deepEqual(result.configurationLineage.bindings.find(row => row.key === "SUPABASE_FUNCTIONS_URL"), { key: "SUPABASE_FUNCTIONS_URL", state: "absent" });
  assert.equal(result.configurationLineage.bindings.find(row => row.key === "DATABASE_URL").updatedAt, 10);
  assert.equal(result.configurationLineage.buildSettings.current.rootDirectory, null);
  assert.equal(result.configurationLineage.buildSettings.current.sourceFilesOutsideRootDirectory, true);
  assert.equal(result.configurationLineage.buildSettings.current.ignoreCommandPresent, false);
  assert.equal(result.configurationLineage.buildSettings.historicalIgnoreCommandPresent, true);
  assert.ok(paths.every(path => !/\/env\//.test(path)));
});

for (const drift of ["none", "config", "epoch", "alias", "source", "source-files", "build-settings"]) {
  test(`actual recovery Plan/parameters/verify CLI handles ${drift} using only stubbed external reads`, () => {
    const root = resolve(import.meta.dirname, "../../test-results"); mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(resolve(root, "recovery-plan-cli-"));
    const sourceSha = "a".repeat(40), envPath = resolve(directory, "github-env");
    writeFileSync(envPath, "");
    const p = provenance(); delete p.bytes;
    const preload = (failure) => `
      import childProcess from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      childProcess.execFileSync = (file, args, options) => {
        if (args[0] === "rev-parse") return "b510fb96578db6d79919decd38d8714008a0adc8";
        if (file !== "git" || JSON.stringify(args) !== JSON.stringify(["diff", "--quiet", ${JSON.stringify(RECOVERY.sha)}, ${JSON.stringify(sourceSha)}, "--", ...${JSON.stringify(SOURCE_SCOPES.map(path => `:(literal)${path}`))}, ":(exclude,literal)src/server/resilience/health-authorization.ts"])) throw new Error("wrong source gate");
        if (Object.keys(options.env).some(key => !["PATH", "SystemRoot"].includes(key))) throw new Error("credential forwarded to Git");
        if (${JSON.stringify(failure)} === "source-files") throw new Error("source closure differs");
        return Buffer.alloc(0);
      };
      syncBuiltinESMExports();
      const proof = ${JSON.stringify(p)}, failure = ${JSON.stringify(failure)}, recovery = ${JSON.stringify(RECOVERY)};
      const project = "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP", team = "team_MMfsiG94K9Zy3e6w7Ccc9xY4";
      const entries = ${JSON.stringify(bindingFixture())};
      if (failure === "config") entries[0].updatedAt++;
      globalThis.fetch = async (input, options) => {
        const url = String(input), path = new URL(url).pathname;
        if (options.method && options.method !== "GET") throw new Error("write attempted");
        if (url.startsWith("https://api.github.com/")) {
          if (path.endsWith("/runs/39652990080")) return Response.json(proof.run);
        }
        if (url.startsWith("https://api.vercel.com/")) {
          if (path === "/v9/projects/" + project) return Response.json({ ...${JSON.stringify(projectFixture())},
            sourceFilesOutsideRootDirectory: failure !== "build-settings" });
          if (path.endsWith("/env")) return Response.json({ envs: entries });
          if (path.endsWith("/aliases")) return Response.json({ aliases: failure === "alias" ? [] : [{ alias: "app.qidaigo.com" }] });
          if (path === "/v13/deployments/" + recovery.id) return Response.json({ ...${JSON.stringify(recoveryDeployment())},
            meta: { ...${JSON.stringify(recoveryDeployment().meta)}, githubCommitSha: failure === "source" ? "b".repeat(40) : recovery.sha } });
        }
        if (["app.qidaigo.com", recovery.url].includes(new URL(url).hostname)) {
          if (path === "/api/connectivity") return new Response(null, { headers: { "x-service-state": "ready" } });
          if (path === "/api/version") return Response.json({ revision: recovery.sha });
          if (path === "/api/availability/config") return Response.json({ mode: "NORMAL_PRIMARY", activeBackend: "PRIMARY", promotionEpoch: failure === "epoch" ? 4 : 3 });
          if (path === "/login") return new Response("login");
        }
        throw new Error("unexpected external read");
      };
    `;
    const cli = fileURLToPath(new URL("../production-application-recovery-plan.mjs", import.meta.url));
    const run = (mode, failure = "none") => spawnSync(process.execPath, ["--max-old-space-size=96", "--import",
      `data:text/javascript,${encodeURIComponent(preload(failure))}`, cli, mode], { cwd: directory, encoding: "utf8", timeout: 10000,
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "KenLeeYa/Stallorder-Platform",
        GITHUB_REF: "refs/heads/main", GITHUB_ACTOR: "KenLeeYa", GITHUB_SHA: sourceSha, GITHUB_ENV: envPath,
        GITHUB_TOKEN: "fixture-github-secret", VERCEL_TOKEN: "fixture-vercel-secret", VERCEL_PROJECT_ID: "prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP",
        VERCEL_ORG_ID: "team_MMfsiG94K9Zy3e6w7Ccc9xY4", APP_BASE_URL: "https://app.qidaigo.com", RELEASE_UNRELATED: "must-not-export" } });
    try {
      const plan = run("plan"); assert.equal(plan.status, 0, plan.stderr);
      const snapshotPath = resolve(directory, "artifacts/production-application-recovery-plan.json");
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
      assert.equal(snapshot.baseline.deploymentId, RECOVERY.id); assert.equal(snapshot.promotionEpoch, 3);
      mkdirSync(resolve(directory, "approved-application-plan"));
      copyFileSync(snapshotPath, resolve(directory, "approved-application-plan/production-application-recovery-plan.json"));
      const parameters = run("parameters"); assert.equal(parameters.status, 0, parameters.stderr);
      const result = run("verify", drift);
      assert.equal(result.status, drift === "none" ? 0 : 1, result.stderr);
      const output = readFileSync(envPath, "utf8") + result.stdout + result.stderr;
      assert.ok(output.includes(JSON.stringify(recoveryPlanParameters(snapshot))));
      assert.ok(!/fixture-(?:github|vercel)-secret|must-not-export/.test(output));
    } finally {
      assert.ok(directory.startsWith(`${root}${sep}recovery-plan-cli-`)); rmSync(directory, { recursive: true, force: true });
    }
  });
}
