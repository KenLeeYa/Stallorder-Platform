import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const DR_REF = "daeqwtpaxcebmtwxqdkj";
const SCHEMAS = ["public", "auth", "storage", "app_private", "internal", "vault"];
const MAGIC = Buffer.from("STAGING-BACKUP-1\n");

export function assertDrBackupTarget(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || url.hostname !== "aws-0-ap-northeast-1.pooler.supabase.com"
    || decodeURIComponent(url.username) !== `postgres.${DR_REF}`
    || url.port !== "5432" || url.pathname !== "/postgres"
    || url.searchParams.get("sslmode") !== "require"
    || url.searchParams.has("hostaddr")) throw new Error("DR_BACKUP_TARGET_INVALID");
  return url;
}

export function sealBackup(bytes, password) {
  if (!password) throw new Error("BACKUP_KEY_MISSING");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(password, salt, 32), iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export function openBackup(bytes, password) {
  if (bytes.length < MAGIC.length + 44 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("BACKUP_FORMAT_INVALID");
  }
  const offset = MAGIC.length;
  const key = scryptSync(password, bytes.subarray(offset, offset + 16), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(offset + 16, offset + 28));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(bytes.subarray(offset + 28, offset + 44));
  return Buffer.concat([decipher.update(bytes.subarray(offset + 44)), decipher.final()]);
}

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function identifier(value) { return `"${value.replaceAll('"', '""')}"`; }
function literal(value) { return `'${value.replaceAll("'", "''")}'`; }

async function main() {
  const mode = process.argv[2];
  if (!["capture", "restore", "verify"].includes(mode)) throw new Error("BACKUP_MODE_REQUIRED");
  if (process.env.DR_SUPABASE_PROJECT_REF !== DR_REF) throw new Error("DR_PROJECT_MISMATCH");
  if (process.env.GITHUB_ACTIONS !== "true"
    || process.env.GITHUB_REPOSITORY !== "KenLeeYa/Stallorder-Platform"
    || process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER
    || process.env.GITHUB_REF !== "refs/heads/codex/dr-to-staging-20261021") {
    throw new Error("BACKUP_INVOCATION_NOT_ALLOWED");
  }
  const url = assertDrBackupTarget(process.env.DR_DIRECT_URL);
  const key = process.env.DR_BACKUP_ENCRYPTION_KEY;
  if (!key || key.length < 24) throw new Error("BACKUP_KEY_MISSING");
  const directory = resolve("dr-staging-backup-private");
  const artifacts = resolve("dr-staging-backup-artifacts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const remote = {
    PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "postgres", PGSSLMODE: "require",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=120000",
  };
  const local = {
    PGHOST: "127.0.0.1", PGPORT: "54322", PGUSER: "postgres", PGPASSWORD: "postgres",
    PGDATABASE: "postgres", PGSSLMODE: "disable", PGOPTIONS: "-c statement_timeout=120000",
  };
  function run(command, args, environment) {
    const result = spawnSync("docker", ["run", "--rm", "--network", "host",
      ...Object.keys(environment).flatMap((name) => ["--env", name]),
      "--volume", `${directory}:/out`, "postgres:17", command, ...args], {
      env: { ...process.env, ...environment }, encoding: "utf8", timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    // pg_restore errors can contain row values. Never emit raw subprocess output.
    if (result.status !== 0) {
      const categories = ["permission denied", "must be owner", "already exists", "does not exist",
        "password authentication failed", "connection refused", "timeout", "violates foreign key constraint",
        "violates unique constraint", "unrecognized configuration parameter"];
      const category = categories.find((value) => result.stderr?.toLowerCase().includes(value));
      const missing = result.stderr?.match(/(?:schema|extension|relation|type|function|role) "([A-Za-z_][A-Za-z0-9_. (),\[\]]{0,120})" does not exist/);
      if (missing) console.error(JSON.stringify({ event: "restore_missing_database_object", object: missing[1] }));
      throw new Error(`${command.toUpperCase()}_FAILED_${result.status ?? "TIMEOUT"}${category ? `_${category.toUpperCase().replaceAll(" ", "_")}` : ""}`);
    }
    return result.stdout.trim();
  }
  function query(sql, environment) {
    return run("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], environment);
  }
  function assertDetached() {
    const state = JSON.parse(query(`select json_build_object(
      'subscriptions', (select count(*) from pg_subscription),
      'readonly', exists(select 1 from public.backend_runtime_state where backend_code='DR'
        and is_current and backend_role='READ_ONLY_STANDBY' and not writes_enabled and enforcement_enabled),
      'active_crons', (select count(*) from cron.job where active))`, remote));
    if (state.subscriptions !== 0 || state.readonly !== true || state.active_crons !== 0) {
      throw new Error("DR_BACKUP_NOT_FENCED");
    }
  }
  function fingerprints(tables, environment) {
    // Both databases execute the identical source-column projection; new local columns cannot hide data loss.
    const sql = tables.map(({ schema, name, columns }) => `select json_build_object(
      'table', ${literal(`${schema}.${name}`)}, 'rows', count(*),
      'digest', md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), '')))
      from (select ${columns.map(identifier).join(",")} from ${identifier(schema)}.${identifier(name)}) t`).join(" union all ");
    return query(sql, environment).split("\n").filter(Boolean).map((line) => JSON.parse(line))
      .sort((a, b) => a.table.localeCompare(b.table));
  }
  async function saveEncrypted(name, bytes) {
    const encrypted = sealBackup(bytes, key);
    if (!openBackup(encrypted, key).equals(bytes)) throw new Error("BACKUP_ROUNDTRIP_FAILED");
    await writeFile(resolve(artifacts, name), encrypted, { mode: 0o600 });
    return { name, sha256: hash(encrypted), bytes: encrypted.length };
  }
  async function decrypted(name) {
    return openBackup(await readFile(resolve(artifacts, name)), key);
  }
  if (mode === "capture") {
    assertDetached();
    const tables = JSON.parse(query(`select coalesce(json_agg(t order by schema,name),'[]') from (
      select c.table_schema as schema,c.table_name as name,json_agg(c.column_name order by c.ordinal_position) as columns
      from information_schema.columns c join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name
      where t.table_type='BASE TABLE' and c.table_schema in (${SCHEMAS.map(literal).join(",")})
      group by c.table_schema,c.table_name) t`, remote));
    const before = fingerprints(tables, remote);
    run("pg_dump", ["--format=custom", "--compress=6", "--no-owner",
      ...SCHEMAS.flatMap((schema) => ["--schema", schema]), "--file=/out/dr.dump"], remote);
    run("pg_restore", ["--list", "/out/dr.dump"], {});
    const archive = await saveEncrypted("database.dump.enc", await readFile(resolve(directory, "dr.dump")));
    const objects = JSON.parse(query("select coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name) order by bucket_id,name),'[]') from storage.objects", remote));
    const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
    if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN_MISSING");
    const response = await fetch(`https://api.supabase.com/v1/projects/${DR_REF}/api-keys?reveal=true`, {
      headers: { authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`DR_KEYS_HTTP_${response.status}`);
    const keys = await response.json();
    const item = keys.find((entry) => entry.type === "secret" && entry.name === "default")
      ?? keys.find((entry) => entry.type === "secret") ?? keys.find((entry) => entry.name === "service_role");
    const storageKey = item?.api_key ?? item?.value;
    if (!storageKey) throw new Error("DR_STORAGE_KEY_MISSING");
    const files = [];
    for (const [index, object] of objects.entries()) {
      const path = [object.bucket, ...object.name.split("/")].map(encodeURIComponent).join("/");
      const download = await fetch(`https://${DR_REF}.supabase.co/storage/v1/object/authenticated/${path}`, {
        headers: { apikey: storageKey, authorization: `Bearer ${storageKey}` }, redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!download.ok) throw new Error(`DR_OBJECT_DOWNLOAD_${download.status}`);
      const bytes = Buffer.from(await download.arrayBuffer());
      files.push({ ...object, plaintextSha256: hash(bytes),
        ...await saveEncrypted(`object-${index}.enc`, bytes) });
    }
    assertDetached();
    if (JSON.stringify(fingerprints(tables, remote)) !== JSON.stringify(before)) throw new Error("DR_CHANGED_DURING_BACKUP");
    await saveEncrypted("manifest.json.enc", Buffer.from(JSON.stringify({
      version: 1, ref: DR_REF, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      tables, fingerprints: before, archive, files,
    })));
    console.log(JSON.stringify({ event: "dr_backup_captured", tables: tables.length, files: files.length, remoteWrites: false }));
  } else if (mode === "restore") {
    // The only writable connection is this loopback-only ephemeral CI database.
    await writeFile(resolve(directory, "restore.dump"), await decrypted("database.dump.enc"), { mode: 0o600 });
    query(`create extension if not exists btree_gist with schema extensions;
      drop schema if exists app_private cascade;
      drop schema if exists internal cascade;
      drop schema public cascade;`, local);
    run("pg_restore", ["--schema-only", "--no-owner", "--no-acl", "--exit-on-error",
      "--schema=public", "--schema=app_private", "--schema=internal", "--dbname=postgres", "/out/restore.dump"], local);
    query(`do $$ declare r record; relations text; begin
      for r in select schemaname,tablename from pg_tables where schemaname in (${SCHEMAS.map(literal).join(",")}) loop
        execute format('alter table %I.%I disable trigger user',r.schemaname,r.tablename);
      end loop;
      select string_agg(format('%I.%I',schemaname,tablename),',') into relations from pg_tables
      where schemaname in (${SCHEMAS.map(literal).join(",")});
      if relations is not null then execute 'truncate ' || relations || ' cascade'; end if;
    end $$`, local);
    run("pg_restore", ["--data-only", "--no-owner", "--no-acl", "--single-transaction", "--exit-on-error",
      "--dbname=postgres", "/out/restore.dump"], local);
    query(`do $$ declare r record; begin
      for r in select schemaname,tablename from pg_tables where schemaname in (${SCHEMAS.map(literal).join(",")}) loop
        execute format('alter table %I.%I enable trigger user',r.schemaname,r.tablename);
      end loop;
    end $$`, local);
  } else {
    const manifest = JSON.parse((await decrypted("manifest.json.enc")).toString());
    if (manifest.ref !== DR_REF || manifest.commit !== process.env.GITHUB_SHA || manifest.runId !== process.env.GITHUB_RUN_ID) {
      throw new Error("BACKUP_MANIFEST_IDENTITY_MISMATCH");
    }
    if (hash(await readFile(resolve(artifacts, manifest.archive.name))) !== manifest.archive.sha256) throw new Error("ARCHIVE_CHANGED");
    if (JSON.stringify(fingerprints(manifest.tables, local)) !== JSON.stringify(manifest.fingerprints)) throw new Error("RESTORED_DATA_MISMATCH");
    for (const file of manifest.files) {
      const encrypted = await readFile(resolve(artifacts, file.name));
      if (hash(encrypted) !== file.sha256 || hash(openBackup(encrypted, key)) !== file.plaintextSha256) throw new Error("RESTORED_FILE_MISMATCH");
    }
    assertDetached();
    if (JSON.stringify(fingerprints(manifest.tables, remote)) !== JSON.stringify(manifest.fingerprints)) throw new Error("DR_CHANGED_AFTER_BACKUP");
    await writeFile(resolve(artifacts, "verification.json"), JSON.stringify({
      version: 1, ref: DR_REF, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      databaseDataRestore: true, tableCount: manifest.tables.length, restoredFileBytes: true,
      fileCount: manifest.files.length, encrypted: true, remoteWrites: false,
      fullProviderRecovery: false, primaryAccessed: false,
      checkedAt: new Date().toISOString(),
    }, null, 2));
    console.log(JSON.stringify({ event: "dr_backup_restore_verified", tables: manifest.tables.length, files: manifest.files.length }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "DR_BACKUP_FAILED";
    console.error(JSON.stringify({ event: "dr_backup_failed", code }));
    process.exitCode = 1;
  });
}
