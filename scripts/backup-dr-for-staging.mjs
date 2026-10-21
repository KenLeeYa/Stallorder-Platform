import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const DR_REF = "daeqwtpaxcebmtwxqdkj";
const PRIMARY_REF = "eyuctbnlvnbnivwasvqr";
const RECOVERY_RULE_IDS = ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896", "f66584a9-6357-4422-8cda-40c8a13c259d"];
const SCHEMAS = ["public", "auth", "storage", "app_private", "internal", "vault"];
const MAGIC = Buffer.from("STAGING-BACKUP-1\n");

export function fileArchiveRecord(object, archive, plaintextSha256) {
  return { bucket: object.bucket, objectPath: object.name, plaintextSha256, ...archive };
}

export function assertFileObjectMapping(files, objects) {
  const filePaths = files.map((file, index) => {
    if (file.name !== `object-${index}.enc` || !file.objectPath) throw new Error("BACKUP_FILE_MAPPING_INVALID");
    return `${file.bucket}\0${file.objectPath}`;
  }).sort();
  const originalPaths = objects.map((object) => `${object.bucket}\0${object.name}`).sort();
  if (new Set(filePaths).size !== files.length
    || JSON.stringify(filePaths) !== JSON.stringify(originalPaths)) throw new Error("BACKUP_FILE_MAPPING_INVALID");
}

export function assertRecoveryRuleSet(rows, columns, parents) {
  if (!Array.isArray(rows) || JSON.stringify(rows.map((row) => row.id).sort()) !== JSON.stringify(RECOVERY_RULE_IDS)) {
    throw new Error("RECOVERY_RULE_SCOPE_INVALID");
  }
  for (const row of rows) {
    if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...columns].sort())) {
      throw new Error("RECOVERY_RULE_COLUMNS_INVALID");
    }
    if (!parents.some((parent) => ["printer_id", "organization_id", "stall_id"].every((key) => parent[key] === row[key]))) {
      throw new Error("RECOVERY_RULE_PARENT_MISSING");
    }
  }
}

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
    || !["refs/heads/codex/dr-to-staging-20261021", "refs/heads/codex/dr-staging-transition-20261022"]
      .includes(process.env.GITHUB_REF)) {
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
    PGHOST: "/var/run/postgresql", PGPORT: "5432", PGUSER: "supabase_admin",
    PGDATABASE: "postgres", PGSSLMODE: "disable", PGOPTIONS: "-c statement_timeout=120000",
  };
  const localContainer = "supabase_db_dr-retirement-restore";
  function run(command, args, environment) {
    const dockerArgs = environment === local
      ? ["exec", ...Object.keys(local).flatMap((name) => ["--env", name]), localContainer, command, ...args]
      : ["run", "--rm", "--network", "host",
      ...Object.keys(environment).flatMap((name) => ["--env", name]),
      "--volume", `${directory}:/out`, "postgres:17", command, ...args];
    const result = spawnSync("docker", dockerArgs, {
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
  function fingerprints(tables, environment, excludeRecoveryRows = false) {
    // Both databases execute the identical source-column projection; new local columns cannot hide data loss.
    const sql = tables.map(({ schema, name, columns }) => `select json_build_object(
      'table', ${literal(`${schema}.${name}`)}, 'rows', count(*),
      'digest', md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), '')))
      from (select ${columns.map(identifier).join(",")} from ${identifier(schema)}.${identifier(name)}
        ${excludeRecoveryRows && schema === "public" && name === "print_rules"
          ? `where id not in (${RECOVERY_RULE_IDS.map(literal).join(",")})` : ""}) t`).join(" union all ");
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
  function recoveryParents(environment) {
    return JSON.parse(query("select coalesce(json_agg(json_build_object('printer_id',id,'organization_id',organization_id,'stall_id',stall_id)),'[]') from public.printers", environment));
  }
  async function recoverySupplement(manifest) {
    if (!manifest.recovery) return null;
    const bytes = await readFile(resolve(artifacts, "reference-recovery.json.enc"));
    if (hash(bytes) !== manifest.recovery.sha256) throw new Error("RECOVERY_ARCHIVE_CHANGED");
    const supplement = JSON.parse(openBackup(bytes, key).toString());
    const columns = manifest.tables.find((table) => table.schema === "public" && table.name === "print_rules")?.columns;
    if (supplement.sourceRef !== PRIMARY_REF || !columns
      || JSON.stringify(supplement.columns) !== JSON.stringify(columns)) throw new Error("RECOVERY_IDENTITY_INVALID");
    assertRecoveryRuleSet(supplement.rows, columns, recoveryParents(local));
    return supplement;
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
    // Preserve the original DR dump byte-for-byte. The known missing parents are
    // separately archived for offline recovery only, never copied into Staging.
    const missingRules = JSON.parse(query(`select coalesce(json_agg(id order by id),'[]') from (
      select distinct j.print_rule_id as id from public.print_jobs j left join public.print_rules r on r.id=j.print_rule_id
      where j.print_rule_id is not null and r.id is null) missing`, remote));
    let recovery = null;
    if (missingRules.length) {
      if (JSON.stringify(missingRules) !== JSON.stringify(RECOVERY_RULE_IDS)) throw new Error("RECOVERY_RULE_SCOPE_INVALID");
      const columns = tables.find((table) => table.schema === "public" && table.name === "print_rules").columns;
      const recoveryResponse = await fetch(`https://api.supabase.com/v1/projects/${PRIMARY_REF}/database/query`, {
        method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        redirect: "error", signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ read_only: true, query: `select coalesce(json_agg(r order by id),'[]') as rules from (
          select ${columns.map(identifier).join(",")} from public.print_rules where id in (${RECOVERY_RULE_IDS.map(literal).join(",")})) r` }),
      });
      if (!recoveryResponse.ok) throw new Error(`RECOVERY_READ_HTTP_${recoveryResponse.status}`);
      const result = await recoveryResponse.json();
      const rows = result[0]?.rules;
      assertRecoveryRuleSet(rows, columns, recoveryParents(remote));
      recovery = await saveEncrypted("reference-recovery.json.enc", Buffer.from(JSON.stringify({
        sourceRef: PRIMARY_REF, columns, rows, capturedAt: new Date().toISOString(), readOnly: true,
      })));
      console.log(JSON.stringify({ event: "recovery_references_captured", rows: rows.length, primaryWrites: false }));
    }
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
      files.push(fileArchiveRecord(object, await saveEncrypted(`object-${index}.enc`, bytes), hash(bytes)));
    }
    assertFileObjectMapping(files, objects);
    assertDetached();
    if (JSON.stringify(fingerprints(tables, remote)) !== JSON.stringify(before)) throw new Error("DR_CHANGED_DURING_BACKUP");
    await saveEncrypted("manifest.json.enc", Buffer.from(JSON.stringify({
      version: 3, ref: DR_REF, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      tables, fingerprints: before, archive, files, recovery,
    })));
    console.log(JSON.stringify({ event: "dr_backup_captured", tables: tables.length, files: files.length, remoteWrites: false }));
  } else if (mode === "restore") {
    const manifest = JSON.parse((await decrypted("manifest.json.enc")).toString());
    // Provider-owned schemas require the local container administrator. This
    // Unix-socket connection can never resolve to either hosted database.
    await writeFile(resolve(directory, "restore.dump"), await decrypted("database.dump.enc"), { mode: 0o600 });
    const restoreSchemas = SCHEMAS.filter((schema) => schema !== "vault");
    query(`${restoreSchemas.map((schema) => `drop schema if exists ${identifier(schema)} cascade; create schema ${identifier(schema)};`).join("\n")}
      create extension if not exists btree_gist with schema extensions;
      create extension if not exists pgcrypto with schema extensions;
      create extension if not exists "uuid-ossp" with schema extensions;
      create extension if not exists supabase_vault;`, local);
    // PostgreSQL's built-in public namespace and provider schemas are created
    // explicitly above. Keep all their objects, data, constraints and triggers.
    const objectList = run("pg_restore", ["--list", "/out/restore.dump"], {})
      .split("\n").filter((line) => !/^\d+; \d+ \d+ SCHEMA - /.test(line)).join("\n");
    await writeFile(resolve(directory, "restore.list"), objectList, { mode: 0o600 });
    for (const [command, ...args] of [
      ["exec", localContainer, "mkdir", "-p", "/out"],
      ["cp", resolve(directory, "restore.dump"), `${localContainer}:/out/restore.dump`],
      ["cp", resolve(directory, "restore.list"), `${localContainer}:/out/restore.list`],
    ]) {
      const copy = spawnSync("docker", [command, ...args], { encoding: "utf8", timeout: 30_000 });
      if (copy.status !== 0) throw new Error("LOCAL_RESTORE_COPY_FAILED");
    }
    for (const section of ["pre-data", "data", "post-data"]) {
      run("pg_restore", [`--section=${section}`, "--no-owner", "--no-acl", "--single-transaction", "--exit-on-error",
        "--use-list=/out/restore.list", "--dbname=postgres", "/out/restore.dump"], local);
      console.log(JSON.stringify({ event: "dr_restore_section_passed", section }));
      if (section === "data") {
        const supplement = await recoverySupplement(manifest);
        if (supplement) {
          // INSERT only: existing DR rows cannot be replaced. Every original FK
          // is subsequently created and validated by the unchanged post-data restore.
          const columns = supplement.columns.map(identifier).join(",");
          query(`insert into public.print_rules (${columns}) select ${columns}
            from json_populate_recordset(null::public.print_rules, ${literal(JSON.stringify(supplement.rows))})`, local);
          console.log(JSON.stringify({ event: "recovery_references_restored", rows: supplement.rows.length }));
        }
      }
    }
  } else {
    const manifest = JSON.parse((await decrypted("manifest.json.enc")).toString());
    if (manifest.ref !== DR_REF || manifest.commit !== process.env.GITHUB_SHA || manifest.runId !== process.env.GITHUB_RUN_ID) {
      throw new Error("BACKUP_MANIFEST_IDENTITY_MISMATCH");
    }
    if (hash(await readFile(resolve(artifacts, manifest.archive.name))) !== manifest.archive.sha256) throw new Error("ARCHIVE_CHANGED");
    const supplement = await recoverySupplement(manifest);
    if (JSON.stringify(fingerprints(manifest.tables, local, Boolean(supplement))) !== JSON.stringify(manifest.fingerprints)) throw new Error("RESTORED_DATA_MISMATCH");
    if (supplement) {
      const rows = JSON.parse(query(`select json_agg(r order by id) from (select ${supplement.columns.map(identifier).join(",")}
        from public.print_rules where id in (${RECOVERY_RULE_IDS.map(literal).join(",")})) r`, local));
      if (JSON.stringify(rows) !== JSON.stringify(supplement.rows)) throw new Error("RECOVERY_DATA_MISMATCH");
    }
    const restoredObjects = JSON.parse(query("select coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name)),'[]') from storage.objects", local));
    assertFileObjectMapping(manifest.files, restoredObjects);
    const objectsDirectory = resolve(directory, "restored-objects");
    for (const file of manifest.files) {
      const encrypted = await readFile(resolve(artifacts, file.name));
      const restored = openBackup(encrypted, key);
      if (hash(encrypted) !== file.sha256 || hash(restored) !== file.plaintextSha256) throw new Error("RESTORED_FILE_MISMATCH");
      const restoredPath = resolve(objectsDirectory, file.bucket, file.objectPath);
      if (!restoredPath.startsWith(`${objectsDirectory}${sep}`)) throw new Error("BACKUP_FILE_PATH_INVALID");
      await mkdir(dirname(restoredPath), { recursive: true, mode: 0o700 });
      await writeFile(restoredPath, restored, { mode: 0o600 });
      if (hash(await readFile(restoredPath)) !== file.plaintextSha256) throw new Error("RESTORED_FILE_READBACK_MISMATCH");
    }
    assertDetached();
    if (JSON.stringify(fingerprints(manifest.tables, remote)) !== JSON.stringify(manifest.fingerprints)) throw new Error("DR_CHANGED_AFTER_BACKUP");
    await writeFile(resolve(artifacts, "verification.json"), JSON.stringify({
      version: 1, ref: DR_REF, commit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      databaseDataRestore: true, tableCount: manifest.tables.length, restoredFileBytes: true,
      fileCount: manifest.files.length, encrypted: true, remoteWrites: false,
      restoredOriginalObjectPaths: true, restoredFileReadback: true,
      fullProviderRecovery: false, primaryAccessed: Boolean(supplement), primaryWrites: false,
      recoveryOnlyReferenceRows: supplement?.rows.length ?? 0, originalReplicaSelfContained: !supplement,
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
