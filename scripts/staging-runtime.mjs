import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setSecret } from "@actions/core";
import { STAGING_TARGET, conversionApi, conversionRequired } from "./dr-staging-conversion-plan.mjs";
import { assertStagingDatabaseTarget } from "./convert-dr-to-staging.mjs";
import { stagingProjectKeys } from "./staging-data-conversion.mjs";
import { readStagingAccess } from "./staging-access-entry.mjs";
import { sealBackup } from "./backup-dr-for-staging.mjs";

export function stagingRuntimeConfiguration({ directUrl, keys, edge, access, sourceSha }) {
  const direct = assertStagingDatabaseTarget(directUrl);
  const transaction = new URL(direct);
  transaction.port = "6543";
  transaction.searchParams.set("pgbouncer", "true");
  transaction.searchParams.set("connection_limit", "4");
  const origin = `https://${STAGING_TARGET.host}`;
  const supabase = `https://${STAGING_TARGET.ref}.supabase.co`;
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.match(access.audience, /^[a-f0-9]{64}$/);
  assert.match(access.teamDomain, /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/);
  const env = {
    DATABASE_URL: transaction.toString(), DIRECT_URL: direct.toString(),
    NEXT_PUBLIC_APP_URL: origin, APP_BASE_URL: origin, FRONTEND_BASE_URL: origin,
    TRUSTED_APP_ORIGINS: origin, PUBLIC_ORDER_FUNCTION_ORIGIN: origin,
    NEXT_PUBLIC_SUPABASE_URL: supabase, NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: `${supabase}/functions/v1`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.publishable, SUPABASE_SECRET_KEY: keys.secret,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    OAUTH_PROVIDER_MODE: "mock", PAYMENT_PROVIDER_MODE: "mock", REPORT_DELIVERY_MODE: "simulate",
    EINVOICE_DEV_MODE: "true", EINVOICE_PRODUCTION_ISSUE_ENABLED: "false", CLOUDPRNT_POC_ENABLED: "false",
    CATALOG_TRANSLATION_ENABLED: "false", ALLOW_DEMO_SEED: "true", PRODUCTION_ENVIRONMENT_APPROVED: "false",
    BACKEND_ACTIVE_TARGET: "PRIMARY", AUTH_PROJECT_CODE: "PRIMARY",
    DR_ACCESS_ENFORCEMENT_ENABLED: "true", DR_ACCESS_HOSTNAME: STAGING_TARGET.host,
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: access.teamDomain, CLOUDFLARE_ACCESS_AUD: access.audience,
    GITHUB_SHA: sourceSha,
  };
  for (const name of ["APP_ENV", "ABUSE_HASH_SECRET", "TOKEN_DERIVATION_SECRET", "TURNSTILE_SECRET_KEY",
    "TURNSTILE_ALLOW_TEST_KEYS", "TURNSTILE_EXPECTED_HOSTNAME", "PUBLIC_APP_ORIGINS", "TRUSTED_CLIENT_IP_HEADER"]) {
    if (edge[name] !== undefined) env[name] = edge[name];
  }
  for (const name of ["AUDIT_IP_HASH_SECRET", "SESSION_FINGERPRINT_HASH_SECRET", "OAUTH_STATE_SECRET",
    "PAYMENT_MOCK_WEBHOOK_SECRET", "DELIVERY_MOCK_WEBHOOK_SECRET", "OFFLINE_PERMIT_SIGNING_SECRET",
    "ATTENDANCE_CHALLENGE_SECRET", "CRON_SECRET", "CRON_API_SECRET"]) env[name] = randomBytes(32).toString("hex");
  return env;
}

export function assertStagingDeployment(deployment, sourceSha) {
  assert.ok(deployment.id?.startsWith("dpl_") && deployment.projectId === STAGING_TARGET.project
    && [null, "preview"].includes(deployment.target) && deployment.readyState === "READY"
    && deployment.meta?.git_commit === sourceSha && deployment.meta?.githubCommitSha === sourceSha
    && deployment.meta?.githubCommitRef === "staging", "STAGING_DEPLOYMENT_INVALID");
}

export function stagingAliasExceptionRequest({ alias, deployment, runtime, access, sourceSha }, action = "create") {
  assertStagingDeployment(deployment, sourceSha);
  assert.ok(alias.alias === STAGING_TARGET.host && alias.projectId === STAGING_TARGET.project
    && alias.deploymentId === deployment.id && /^[a-f0-9]{128}$/.test(alias.uid), "STAGING_ALIAS_READBACK_FAILED");
  assert.ok(runtime.DR_ACCESS_ENFORCEMENT_ENABLED === "true" && runtime.DR_ACCESS_HOSTNAME === STAGING_TARGET.host
    && runtime.CLOUDFLARE_ACCESS_AUD === access.audience
    && runtime.CLOUDFLARE_ACCESS_TEAM_DOMAIN === access.teamDomain, "STAGING_ORIGIN_GUARD_MISSING");
  assert.ok(["create", "revoke"].includes(action), "STAGING_ALIAS_EXCEPTION_INVALID");
  return { path: `/aliases/${alias.uid}/protection-bypass`, options: { method: "PATCH",
    body: JSON.stringify({ override: { action, scope: "alias-protection-override" } }) } };
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 900_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...env } });
  assert.equal(result.status, 0, "STAGING_DEPLOY_COMMAND_FAILED");
  return result.stdout;
}

export async function deployStagingRuntime(plan, verifyPrimary) {
  const access = await readStagingAccess(plan);
  const edge = JSON.parse(await readFile("staging-conversion-private/edge.json", "utf8"));
  const keys = await stagingProjectKeys();
  const runtime = stagingRuntimeConfiguration({ directUrl: conversionRequired("DR_DIRECT_URL"), keys, edge, access, sourceSha: plan.sourceSha });
  for (const [key, value] of Object.entries(runtime)) if (/SECRET|KEY|DATABASE_URL|DIRECT_URL/.test(key)) setSecret(value);
  await writeFile("staging-conversion-private/runtime.json", JSON.stringify(runtime), { mode: 0o600 });
  await writeFile("artifacts/staging-runtime-recovery.json.enc",
    sealBackup(Buffer.from(JSON.stringify(runtime)), conversionRequired("DR_BACKUP_ENCRYPTION_KEY")), { mode: 0o600 });
  const current = await conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}/env`);
  assert.ok(current.envs?.length === 0 && !current.pagination?.next, "STAGING_RUNTIME_PRESTATE_CHANGED");
  // Create only Preview variables; never upsert or inherit Production settings.
  const entries = Object.entries(runtime);
  for (let offset = 0; offset < entries.length; offset += 4) {
    await Promise.all(entries.slice(offset, offset + 4).map(async ([key, value]) => {
      const result = await conversionApi("vercel", `/v10/projects/${STAGING_TARGET.project}/env`, {
        method: "POST", body: JSON.stringify({ key, value, type: "encrypted", target: ["preview"],
          comment: `Independent synthetic Staging ${plan.sourceSha}` }),
      });
      assert.ok(!result.failed?.length, "STAGING_RUNTIME_CREATE_FAILED");
    }));
    await verifyPrimary();
  }
  const readback = await conversionApi("vercel", `/v10/projects/${STAGING_TARGET.project}/env?decrypt=true`);
  const variables = Array.isArray(readback) ? readback : readback.envs;
  assert.equal(variables?.length, entries.length, "STAGING_RUNTIME_SCOPE_CHANGED");
  for (const [key, value] of entries) {
    const variable = variables.find((item) => item.key === key);
    assert.ok(variable?.value === value && variable.target?.length === 1 && variable.target[0] === "preview"
      && !variable.gitBranch && !variable.sharedEnvVariableId, "STAGING_RUNTIME_READBACK_FAILED");
  }
  // Edge functions use only this project's independently rotated secrets.
  run("supabase", ["functions", "deploy", "--project-ref", STAGING_TARGET.ref, "--use-api", "--yes"]);
  await verifyPrimary();
  // Upload only the reviewed Git tree. The runner also holds decrypted Access,
  // runtime and recovery inputs, which must never enter a deployment bundle.
  const source = "staging-conversion-private/deploy";
  await mkdir(`${source}/.vercel`, { recursive: true });
  run("git", ["archive", "--format=tar", "--output=staging-conversion-private/source.tar", plan.sourceSha]);
  run("tar", ["-xf", "staging-conversion-private/source.tar", "-C", source]);
  await writeFile(`${source}/.vercel/project.json`, JSON.stringify({ orgId: STAGING_TARGET.team, projectId: STAGING_TARGET.project }));
  run("git", ["switch", "-C", "staging", plan.sourceSha]);
  const args = ["--yes", "vercel@58.3.0", "deploy", source, "--yes", "--target", "preview", "--json",
    "--token", conversionRequired("VERCEL_TOKEN"), "--project", STAGING_TARGET.project,
    "--meta", `git_commit=${plan.sourceSha}`, "--meta", "githubDeployment=1", "--meta", "githubCommitRef=staging",
    "--meta", `githubCommitSha=${plan.sourceSha}`, "--meta", `staging_conversion_run=${process.env.GITHUB_RUN_ID}`];
  const parsed = JSON.parse(run("npx", args, { VERCEL_PROJECT_ID: STAGING_TARGET.project, VERCEL_ORG_ID: STAGING_TARGET.team }));
  const deployment = parsed.deployment ?? parsed;
  const details = await conversionApi("vercel", `/v13/deployments/${deployment.id}`);
  assertStagingDeployment(details, plan.sourceSha);
  await verifyPrimary();
  await writeFile("artifacts/staging-deployment.json", JSON.stringify({ sourceSha: plan.sourceSha,
    projectId: details.projectId, deploymentId: details.id, deploymentUrl: details.url, target: "preview",
    backend: STAGING_TARGET.ref, origin: `https://${STAGING_TARGET.host}`, primaryWrites: false }, null, 2));
  await conversionApi("vercel", `/v2/deployments/${details.id}/aliases`, {
    method: "POST", body: JSON.stringify({ alias: STAGING_TARGET.host }),
  });
  const alias = await conversionApi("vercel", `/v4/aliases/${STAGING_TARGET.host}`);
  assert.ok(alias.projectId === STAGING_TARGET.project && alias.deploymentId === details.id, "STAGING_ALIAS_READBACK_FAILED");
  await verifyPrimary();
  return details;
}

export async function verifyStagingEntryTls(plan, verifyPrimary) {
  const access = await readStagingAccess(plan);
  const alias = await conversionApi("vercel", `/v4/aliases/${STAGING_TARGET.host}`);
  assert.equal(alias.projectId, STAGING_TARGET.project, "STAGING_ALIAS_READBACK_FAILED");
  const deployment = await conversionApi("vercel", `/v13/deployments/${alias.deploymentId}`);
  const runtime = JSON.parse(await readFile("staging-conversion-private/runtime.json", "utf8"));
  const scope = { alias, deployment, runtime, access, sourceSha: plan.sourceSha };
  const exception = stagingAliasExceptionRequest(scope);
  const project = await conversionApi("vercel", `/v9/projects/${STAGING_TARGET.project}`);
  assert.ok(project.id === STAGING_TARGET.project && project.ssoProtection?.deploymentType === "all_except_custom_domains",
    "STAGING_GENERATED_ORIGIN_PROTECTION_CHANGED");
  const dnsPath = `/zones/${STAGING_TARGET.zone}/dns_records/${access.dnsId}`;
  // Standard protection includes Preview custom domains. Transfer only this
  // exact alias to Access + origin JWT; generated URLs retain Vercel protection.
  await conversionApi("vercel", exception.path, exception.options);
  let protectedOrigin = false;
  // Certificate issuance may require DNS-only resolution. This is permitted only
  // after the isolated, JWT-enforcing candidate is assigned; never before it.
  try {
    const readback = await conversionApi("vercel", `/v4/aliases/${STAGING_TARGET.host}`);
    stagingAliasExceptionRequest({ ...scope, alias: readback });
    assert.equal(readback.uid, alias.uid, "STAGING_ALIAS_READBACK_FAILED");
    assert.ok(Object.values(readback.protectionBypass ?? {}).some((value) => value.scope === "alias-protection-override"),
      "STAGING_ALIAS_EXCEPTION_NOT_VERIFIED");
    await conversionApi("cloudflare", dnsPath, { method: "PATCH", body: JSON.stringify({ proxied: false, ttl: 60 }) });
    await verifyPrimary();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`https://${STAGING_TARGET.host}/login`, {
        redirect: "manual", signal: AbortSignal.timeout(8_000),
      }).catch(() => null);
      if (response?.status === 403 && response.headers.get("server")?.toLowerCase() === "vercel"
        && (await response.text()).trim() === "") { protectedOrigin = true; break; }
      assert.ok(response?.status !== 200, "STAGING_ORIGIN_EXPOSED");
      if (attempt % 6 === 0) await verifyPrimary();
      await new Promise((done) => setTimeout(done, 5_000));
    }
    assert.ok(protectedOrigin, "STAGING_ORIGIN_TLS_NOT_VERIFIED");
  } finally {
    try {
      if (!protectedOrigin) {
        const revoke = stagingAliasExceptionRequest(scope, "revoke");
        await conversionApi("vercel", revoke.path, revoke.options);
        const restored = await conversionApi("vercel", `/v4/aliases/${STAGING_TARGET.host}`);
        assert.ok(!Object.values(restored.protectionBypass ?? {}).some((value) => value.scope === "alias-protection-override"),
          "STAGING_ALIAS_EXCEPTION_NOT_REVOKED");
      }
    } finally {
      await conversionApi("cloudflare", dnsPath, { method: "PATCH", body: JSON.stringify({ proxied: true, ttl: 1 }) });
      await verifyPrimary();
    }
  }
}
