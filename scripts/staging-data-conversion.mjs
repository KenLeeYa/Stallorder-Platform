import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { STAGING_TARGET, conversionApi, conversionDigest, conversionQuery, conversionRequired } from "./dr-staging-conversion-plan.mjs";
import { assertFileObjectMapping, sealBackup } from "./backup-dr-for-staging.mjs";
import { assertStagingDatabaseTarget } from "./convert-dr-to-staging.mjs";
import { retiredDrSequenceCleanupSql, disableStagingCronsSql, syntheticStagingSafetySql } from "./lib/dr-reset-preparation.mjs";

const PREFIX = `/v1/projects/${STAGING_TARGET.ref}`;
const ORIGIN = `https://${STAGING_TARGET.ref}.supabase.co`;

export function stagingAuthPatch(source) {
  const patch = { disable_signup: true, site_url: `https://${STAGING_TARGET.host}`,
    uri_allow_list: `https://${STAGING_TARGET.host}/auth/callback`,
    smtp_host: "disabled.staging.invalid", smtp_port: "465", smtp_user: "disabled",
    smtp_pass: randomBytes(32).toString("hex"), smtp_admin_email: "disabled@example.invalid",
    smtp_sender_name: "Staging email disabled" };
  for (const [name, value] of Object.entries(source)) {
    if (/^(external_|hook_).+_enabled$/.test(name) && typeof value === "boolean") patch[name] = false;
    if (/^(external_|hook_|sms_)/.test(name)
      && /(?:_secret|_secrets|_client_id|_token|_password|_pass|_key|_uri)$/.test(name)) {
      // Supabase validates Hook URI/secret format even when the Hook is disabled.
      patch[name] = name.startsWith("hook_") ? null : "";
    }
  }
  return patch;
}

export function stagingEdgeConfiguration() {
  return { ABUSE_HASH_SECRET: randomBytes(32).toString("hex"), TOKEN_DERIVATION_SECRET: randomBytes(32).toString("hex"),
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", APP_ENV: "test",
    TURNSTILE_ALLOW_TEST_KEYS: "true", TURNSTILE_EXPECTED_HOSTNAME: STAGING_TARGET.host,
    PUBLIC_APP_ORIGINS: `https://${STAGING_TARGET.host}`, TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip" };
}

export function scopedDatabaseEnvironment(source) {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("PG") || name.startsWith("PRIMARY_") || name.startsWith("DR_")
      || ["DATABASE_URL", "DIRECT_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"].includes(name)) delete environment[name];
  }
  environment.PGSSLMODE = "require";
  return environment;
}

function cli(args, { database = false } = {}) {
  const result = spawnSync("supabase", args, { encoding: "utf8", timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024, env: database ? scopedDatabaseEnvironment(process.env) : process.env });
  // Never emit captured SQL, connection strings, values or provider error bodies.
  assert.equal(result.status, 0, "STAGING_SUPABASE_COMMAND_FAILED");
  return `${result.stdout}${result.stderr}`;
}

export async function isolateStagingProviders(plan) {
  const [auth, secrets] = await Promise.all([
    conversionApi("supabase", `${PREFIX}/config/auth`), conversionApi("supabase", `${PREFIX}/secrets`),
  ]);
  assert.equal(conversionDigest(auth), plan.providerPrestate.authDigest, "STAGING_AUTH_PRESTATE_CHANGED");
  assert.equal(conversionDigest(secrets), plan.providerPrestate.edgeSecretsDigest, "STAGING_EDGE_PRESTATE_CHANGED");
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/staging-provider-recovery.json.enc", sealBackup(Buffer.from(JSON.stringify({
    ref: STAGING_TARGET.ref, sourceSha: plan.sourceSha, auth, edgeSecretMetadata: secrets,
    fullProviderRecovery: false,
  })), conversionRequired("DR_BACKUP_ENCRYPTION_KEY")), { mode: 0o600 });
  const patch = stagingAuthPatch(auth);
  await conversionApi("supabase", `${PREFIX}/config/auth`, { method: "PATCH", body: JSON.stringify(patch) });
  const updated = await conversionApi("supabase", `${PREFIX}/config/auth`);
  for (const [name, value] of Object.entries(patch)) {
    if (name === "smtp_pass") continue; // Some provider versions redact this unused credential.
    assert.ok(value == null || value === "" ? updated[name] == null || updated[name] === "" : String(updated[name]) === String(value),
      "STAGING_AUTH_ISOLATION_FAILED");
  }
  const names = secrets.map((item) => item.name).filter((name) => !name.startsWith("SUPABASE_"));
  assert.ok(names.length < 100 && names.every((name) => /^[A-Z][A-Z0-9_]{0,127}$/.test(name)), "STAGING_EDGE_SCOPE_INVALID");
  if (names.length) cli(["secrets", "unset", "--project-ref", STAGING_TARGET.ref, "--yes", ...names]);
  const edge = stagingEdgeConfiguration();
  await conversionApi("supabase", `${PREFIX}/secrets`, { method: "POST",
    body: JSON.stringify(Object.entries(edge).map(([name, value]) => ({ name, value }))) });
  const readback = await conversionApi("supabase", `${PREFIX}/secrets`);
  assert.deepEqual(readback.map((item) => item.name).filter((name) => !name.startsWith("SUPABASE_")).sort(), Object.keys(edge).sort(),
    "STAGING_EDGE_SECRET_SCOPE_CHANGED");
  for (const [name, value] of Object.entries(edge)) {
    assert.equal(readback.find((item) => item.name === name)?.value, conversionDigest(value), "STAGING_EDGE_SECRET_READBACK_FAILED");
  }
  await mkdir("staging-conversion-private", { recursive: true, mode: 0o700 });
  await writeFile("staging-conversion-private/edge.json", JSON.stringify(edge), { mode: 0o600 });
}

export async function stagingProjectKeys() {
  const keys = await conversionApi("supabase", `${PREFIX}/api-keys?reveal=true`);
  const secret = keys.find((item) => item.type === "secret" && item.name === "default")
    ?? keys.find((item) => item.type === "secret") ?? keys.find((item) => item.name === "service_role");
  const publishable = keys.find((item) => item.type === "publishable" && item.name === "default")
    ?? keys.find((item) => item.type === "publishable") ?? keys.find((item) => item.name === "anon");
  assert.ok(secret?.api_key && publishable?.api_key, "STAGING_PROJECT_KEYS_MISSING");
  return { secret: secret.api_key, publishable: publishable.api_key };
}

export async function removeBackedUpStorage(manifest, verifyPrimary) {
  const objects = await conversionQuery("select bucket_id as bucket,name from storage.objects order by bucket_id,name");
  assertFileObjectMapping(manifest.files, objects);
  const { secret } = await stagingProjectKeys();
  const request = (path, options = {}) => fetch(`${ORIGIN}/storage/v1/${path}`, {
    ...options, headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" },
    redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const pathOf = (file) => [file.bucket, ...file.objectPath.split("/")].map(encodeURIComponent).join("/");
  // Verify every current byte before removing the first object, not just metadata.
  for (const file of manifest.files) {
    const response = await request(`object/authenticated/${pathOf(file)}`);
    assert.ok(response.ok, "STAGING_SOURCE_FILE_UNREADABLE");
    assert.equal(conversionDigest(Buffer.from(await response.arrayBuffer())), file.plaintextSha256, "STAGING_SOURCE_FILE_CHANGED");
  }
  await verifyPrimary();
  for (const bucket of new Set(manifest.files.map((file) => file.bucket))) {
    const files = manifest.files.filter((file) => file.bucket === bucket);
    const response = await request(`object/${encodeURIComponent(bucket)}`, {
      method: "DELETE", body: JSON.stringify({ prefixes: files.map((file) => file.objectPath) }),
    });
    assert.ok(response.ok, "STAGING_STORAGE_DELETE_FAILED");
    await verifyPrimary();
    for (const file of files) {
      const readback = await request(`object/authenticated/${pathOf(file)}`);
      // Storage may encode missing objects as HTTP 400 with a typed 404 body.
      const body = await readback.json().catch(() => null);
      assert.ok(readback.status === 404 || (readback.status === 400 && Number(body?.statusCode) === 404),
        "STAGING_STORAGE_DELETE_NOT_VERIFIED");
    }
  }
  const [state] = await conversionQuery("select count(*)::int as objects from storage.objects");
  assert.equal(state.objects, 0, "STAGING_STORAGE_NOT_EMPTY");
  await writeFile("artifacts/staging-storage-retirement.json", JSON.stringify({
    ref: STAGING_TARGET.ref, sourceSha: process.env.GITHUB_SHA, filesRemoved: manifest.files.length,
    exactBackupPaths: true, bytesCheckedBeforeDelete: true, authenticatedReadbackMissing: true,
    primaryWrites: false,
  }, null, 2));
}

export async function clearRetiredDrCredentials() {
  await conversionQuery(`delete from vault.secrets;
    ${disableStagingCronsSql}
    drop schema if exists app_private cascade;
    drop schema if exists internal cascade;
    ${retiredDrSequenceCleanupSql}`, false);
}

export async function resetAndSeedStaging() {
  const target = assertStagingDatabaseTarget(conversionRequired("DR_DIRECT_URL"));
  const result = cli(["db", "reset", "--db-url", target.toString(), "--no-seed", "--yes"], { database: true });
  assert.ok(result.includes("Resetting remote database") && !result.includes("Recreating database"), "STAGING_RESET_PATH_INVALID");
  await conversionQuery(`${disableStagingCronsSql} select pg_notify('pgrst','reload schema');`, false);
  await conversionQuery(await readFile("supabase/seed.sql", "utf8"), false);
  // Preserve the full recursive suite and its ordering, but avoid putting the
  // observed 12+ minute hosted suite inside a single ten-minute subprocess.
  const tests = (await readdir("supabase/tests", { recursive: true }))
    .filter((name) => name.endsWith(".sql")).map((name) => `supabase/tests/${name.replaceAll("\\", "/")}`).sort();
  assert.ok(tests.length > 0, "STAGING_DATABASE_TESTS_MISSING");
  for (let offset = 0; offset < tests.length; offset += 20) {
    cli(["test", "db", ...tests.slice(offset, offset + 20), "--db-url", target.toString()], { database: true });
    console.info(`Staging database tests: ${Math.min(offset + 20, tests.length)}/${tests.length} files passed`);
  }
  cli(["db", "lint", "--db-url", target.toString(), "--level", "warning", "--fail-on", "warning"], { database: true });
  await conversionQuery(syntheticStagingSafetySql, false);
}

export async function verifySyntheticStaging(plan) {
  const [state] = await conversionQuery(`select
    (select count(*)::int from public.organizations) as organizations,
    (select count(*)::int from public.orders where not is_test) as real_orders,
    (select count(*)::int from vault.secrets) as vault,
    (select count(*)::int from auth.users) as auth_users,
    (select count(*)::int from storage.objects) as files,
    (select count(*)::int from pg_subscription) as subscriptions,
    (select count(*)::int from cron.job where active) as active_crons,
    (select count(*)::int from net.http_request_queue) as outgoing_requests,
    (select count(*)::int from public.printers where is_enabled) as enabled_printers,
    (select count(*)::int from public.payment_options where is_enabled and kind <> 'CASH') as enabled_non_cash,
    (select count(*)::int from supabase_migrations.schema_migrations) as migrations`);
  assert.equal(state.organizations, 2, "STAGING_SYNTHETIC_TENANTS_INVALID");
  assert.equal(state.migrations, plan.migrationCount, "STAGING_MIGRATIONS_INVALID");
  for (const [key, value] of Object.entries(state)) {
    if (!["organizations", "migrations"].includes(key)) assert.equal(value, 0, "STAGING_SYNTHETIC_ISOLATION_FAILED");
  }
  await writeFile("artifacts/staging-data-conversion.json", JSON.stringify({
    ref: STAGING_TARGET.ref, sourceSha: plan.sourceSha, backup: plan.backup,
    oldDataRemoved: true, syntheticOnly: true, state, primaryWrites: false,
  }, null, 2));
  return state;
}
