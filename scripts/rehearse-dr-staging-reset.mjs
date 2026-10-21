import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { retiredDrSequenceCleanupSql, disableStagingCronsSql } from "./lib/dr-reset-preparation.mjs";

const CONTAINER = "supabase_db_dr-retirement-restore";
let operation = "TARGET_CHECK";
let knownObjects = [];

export function rehearsalEnvironment(source) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("DR_") || key.startsWith("PRIMARY_") || key.startsWith("PG")
      || ["DATABASE_URL", "DIRECT_URL", "SUPABASE_ACCESS_TOKEN"].includes(key)) delete environment[key];
  }
  // CLI 2.109.1 reconstructs remote connection URLs without the sslmode query.
  // This process can address only the disposable loopback target checked above;
  // no hosted reset or hosted TLS override belongs to this rehearsal.
  environment.PGSSLMODE = "disable";
  return environment;
}

export function rehearsalFailureCode(result, stage, catalogObjects = []) {
  assert.match(stage, /^[A-Z_]+$/);
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const failure = [...output.matchAll(/(?:ERROR|FATAL):[^\r\n]+/g)].at(-1)?.[0] ?? output;
  const category = ["permission denied", "must be owner", "already exists", "does not exist",
    "password authentication failed", "violates foreign key constraint", "cannot truncate",
    "cannot drop", "connection refused", "server refused tls", "failed to connect", "failed to parse",
    "unrecognized configuration parameter", "must be superuser", "read-only transaction",
    "no such file", "unknown flag", "direct deletion", "dependent objects"]
    .find((value) => failure.toLowerCase().includes(value));
  const sqlState = failure.match(/SQLSTATE ([0-9A-Z]{5})\b/)?.[1];
  const object = failure.match(/(?:relation|table|schema|sequence|type|function) "([a-zA-Z_][a-zA-Z0-9_]{0,63})"/)?.[1];
  const migration = [...output.matchAll(/Applying migration ([0-9]{14}_[a-z0-9_]+)\.sql/g)].at(-1)?.[1];
  return `REHEARSAL_${stage}_FAILED${category ? `_${category.toUpperCase().replaceAll(" ", "_").replaceAll("-", "_")}` : ""}${sqlState ? `_${sqlState}` : ""}${object && catalogObjects.includes(object) ? `_OBJECT_${object.toUpperCase()}` : ""}${migration ? `_MIGRATION_${migration.toUpperCase()}` : ""}`;
}

export function assertRehearsalTarget(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "postgresql:" && url.hostname === "127.0.0.1"
    && url.port === "54322" && url.username === "postgres"
    && url.pathname === "/postgres" && url.search === "?sslmode=disable",
  "REHEARSAL_TARGET_INVALID");
  return url;
}

async function main() {
  assert.ok(process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform"
    && process.env.GITHUB_ACTOR === "KenLeeYa"
    && process.env.GITHUB_REF === "refs/heads/codex/dr-staging-transition-20261022",
  "REHEARSAL_INVOCATION_INVALID");
  const proof = JSON.parse(await readFile("dr-staging-backup-artifacts/verification.json", "utf8"));
  assert.ok(proof.runId === process.env.GITHUB_RUN_ID && proof.commit === process.env.GITHUB_SHA
    && proof.ref === "daeqwtpaxcebmtwxqdkj" && proof.databaseDataRestore
    && proof.restoredFileReadback && proof.restoredOriginalObjectPaths && proof.remoteWrites === false,
  "REHEARSAL_RESTORE_PROOF_REQUIRED");
  const config = await readFile("supabase/config.toml", "utf8");
  assert.match(config, /\[db\]\s+port = 54322/, "REHEARSAL_CONFIG_INVALID");
  // Give the CLI a private copy with a different configured local port. The
  // explicit 54322 URL must take its remote-reset SQL path, not remove/recreate
  // any local Docker container or volume. Migrations remain byte-for-byte copies.
  const cliWorkdir = resolve("dr-staging-backup-private", "reset-rehearsal");
  await mkdir(resolve(cliWorkdir, "supabase"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(cliWorkdir, "supabase/config.toml"),
    config.replace(/(\[db\]\s+port = )54322/, (_match, prefix) => `${prefix}55432`), { mode: 0o600 });
  await cp("supabase/migrations", resolve(cliWorkdir, "supabase/migrations"), { recursive: true });
  const inspect = JSON.parse(run("docker", ["inspect", CONTAINER]));
  assert.equal(inspect[0]?.Name, `/${CONTAINER}`, "REHEARSAL_CONTAINER_INVALID");
  assert.ok(inspect[0]?.State?.Running
    && inspect[0]?.NetworkSettings?.Ports?.["5432/tcp"]?.some((port) => port.HostPort === "54322"),
  "REHEARSAL_CONTAINER_INVALID");
  operation = "READ_BASELINE";
  const original = JSON.parse(sql("select json_build_object('orders',(select count(*) from public.orders),'vault',(select count(*) from vault.secrets))"));
  knownObjects = JSON.parse(sql("select json_agg(name) from (select relname as name from pg_class union select nspname from pg_namespace union select typname from pg_type) names"));
  const password = randomBytes(32).toString("hex");
  operation = "LOCAL_PASSWORD";
  sql(`alter role postgres password '${password}';`);
  // Local-only simulation of confirmed Storage API removal. This is not
  // evidence that any hosted file was removed.
  operation = "REMOVE_VAULT";
  applicationSql("delete from vault.secrets;");
  operation = "REMOVE_FILES";
  sql("truncate storage.objects cascade;");
  operation = "REMOVE_SCHEMAS";
  applicationSql("drop schema if exists app_private cascade; drop schema if exists internal cascade;");
  operation = "SEQUENCE_REGRESSION";
  applicationSql(`begin;
    create table public.__dr_sequence_fixture (id bigint generated always as identity primary key);
    create sequence public.__dr_standalone_fixture;
    ${retiredDrSequenceCleanupSql}
    do $$ begin
      if to_regclass('public.__dr_standalone_fixture') is not null
        or to_regclass(pg_get_serial_sequence('public.__dr_sequence_fixture','id')) is null then
        raise exception 'SEQUENCE_REGRESSION_FAILED';
      end if;
    end $$;
    rollback;`);
  operation = "REMOVE_SEQUENCES";
  applicationSql(retiredDrSequenceCleanupSql);
  const url = assertRehearsalTarget(`postgresql://postgres:${password}@127.0.0.1:54322/postgres?sslmode=disable`);
  operation = "REMOTE_RESET";
  const resetLog = run("supabase", ["db", "reset", "--workdir", cliWorkdir,
    "--db-url", url.toString(), "--no-seed", "--yes"]);
  assert.ok(resetLog.includes("Resetting remote database") && !resetLog.includes("Recreating database"),
    "REHEARSAL_RESET_PATH_INVALID");
  // SQL replay creates cron jobs. No old credentials exist; leave all jobs
  // inactive before synthetic data or any application is introduced.
  operation = "STOP_CRONS";
  applicationSql(`${disableStagingCronsSql} select pg_notify('pgrst','reload schema');`);
  operation = "SYNTHETIC_SEED";
  applicationSql(await readFile("supabase/seed.sql", "utf8"));
  operation = "VERIFY_SYNTHETIC";
  const state = JSON.parse(sql(`select json_build_object(
    'orders',(select count(*) from public.orders),
    'real_orders',(select count(*) from public.orders where not is_test),
    'organizations',(select count(*) from public.organizations),
    'vault',(select count(*) from vault.secrets),
    'auth_users',(select count(*) from auth.users),
    'files',(select count(*) from storage.objects),
    'subscriptions',(select count(*) from pg_subscription),
    'active_crons',(select count(*) from cron.job where active),
    'migrations',(select count(*) from supabase_migrations.schema_migrations))`));
  assert.ok(state.real_orders === 0 && state.vault === 0 && state.auth_users === 0
    && state.files === 0 && state.subscriptions === 0 && state.active_crons === 0
    && state.organizations === 2 && state.migrations === 146, "REHEARSAL_SYNTHETIC_STATE_INVALID");
  await writeFile("dr-staging-backup-artifacts/reset-rehearsal.json", JSON.stringify({
    sourceSha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    originalOrders: original.orders, removedVaultEntries: original.vault,
    syntheticState: state, remoteWrites: false, hostedCleanup: false,
    exactCliRemoteResetPath: true, localAdministratorUsed: true,
    localStorageRemovalSimulated: true,
    sequenceRegression: true,
    applicationRole: "postgres",
  }, null, 2));
  console.log("PASS: original DR restore reset and synthetic seed on disposable loopback only.");
}

function sql(query) {
  return run("docker", ["exec", "-i", CONTAINER, "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", "/var/run/postgresql", "-U", "supabase_admin", "-d", "postgres"], query, false);
}

function applicationSql(query) {
  return sql(`set role postgres;\n${query}\nreset role;`);
}

function run(command, args, input, includeStderr = true) {
  const result = spawnSync(command, args, { input, env: rehearsalEnvironment(process.env), encoding: "utf8",
    timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(rehearsalFailureCode(result, operation, knownObjects));
  }
  return `${result.stdout}${includeStderr ? result.stderr : ""}`.trim();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(/^REHEARSAL_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "REHEARSAL_FAILED");
    process.exitCode = 1;
  });
}
