// Offline restore adapter only. The protected caller must authenticate the
// immutable artifacts before passing plaintext; this cannot qualify an Apply.
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { assertRecoveryRuleSet, restoreArguments } from "./backup-dr-for-staging.mjs";
import { retiredDrSequenceCleanupSql } from "./lib/dr-reset-preparation.mjs";
import { captureRemainingSnapshot } from "./staging-partial-retirement-snapshot.mjs";

const database = "partial_retirement_proof";
const schemas = ["public", "auth", "storage", "app_private", "internal", "vault"];
const recoveryIds = ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896",
  "f66584a9-6357-4422-8cda-40c8a13c259d"];
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

function requireRestore(condition, code) {
  if (!condition) throw new Error(`STAGING_PARTIAL_RESTORE_${code}`);
}

function docker(args, input) {
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase())));
  const host = process.platform === "win32" ? "npipe:////./pipe/docker_engine" : "unix:///var/run/docker.sock";
  const result = spawnSync("docker", ["--host", host, ...args], {
    input, env: environment, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  requireRestore(!result.error && result.status === 0, "COMMAND_FAILED");
  return result.stdout.trim();
}

export function restorePartialProofCopy(input) {
  return runRestore(input, false);
}

// Still a low-level offline adapter, not an authenticated protected entry.
export function restoreAndReplayPartialProofCopy(input) {
  return runRestore(input, true);
}

function runRestore(input, replay) {
  try { return restoreCopy(input, replay); }
  catch (error) {
    throw new Error(/^STAGING_PARTIAL_RESTORE_[A-Z_]+$/.test(error?.message ?? "")
      ? error.message : "STAGING_PARTIAL_RESTORE_FAILED");
  }
}

function restoreCopy({ containerId, dump, manifest, supplement }, replay) {
  requireRestore(typeof containerId === "string" && /^[a-f0-9]{64}$/.test(containerId), "TARGET_INVALID");
  const [target] = JSON.parse(docker(["inspect", containerId]));
  requireRestore(target?.Id === containerId && target.State?.Running === true
    // containerd reports the pinned OCI index; classic Docker reports the
    // linux/amd64 config from its b021e960... manifest. Both are content-bound.
    && ["sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
      "sha256:2d3ac69ad5c95d81458cc93a6cc6c31a98dfa00cd28f88a0a9358d315e1c357a"].includes(target.Image)
    && ["sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
      "public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453"].includes(target.Config?.Image)
    && /^\/dr-staging-partial-proof-[a-z0-9-]+$/.test(target.Name)
    && target.Config?.Labels?.owner === "dr-staging-transition-20261022"
    && target.Config.Labels.task === "staging-partial-retirement-proof"
    && target.HostConfig?.NetworkMode === "none" && target.HostConfig.Privileged === false
    && !target.HostConfig.PidMode && [undefined, "private"].includes(target.HostConfig.IpcMode)
    && (target.HostConfig.CapAdd ?? []).length === 0 && (target.HostConfig.Devices ?? []).length === 0
    && Object.keys(target.HostConfig.PortBindings ?? {}).length === 0
    && target.NetworkSettings?.Ports && Object.values(target.NetworkSettings.Ports).every(ports => ports === null)
    && target.Mounts?.length === 0, "TARGET_INVALID");
  requireRestore(Buffer.isBuffer(dump) && dump.subarray(0, 5).toString() === "PGDMP"
    && Array.isArray(manifest?.tables) && manifest.tables.length > 0
    && manifest.tables.every(table => schemas.includes(table.schema) && typeof table.name === "string"
      && Array.isArray(table.columns) && table.columns.length > 0 && table.columns.every(column => typeof column === "string"))
    && Array.isArray(manifest.fingerprints), "INPUT_INVALID");
  const columns = manifest.tables.find(table => table.schema === "public" && table.name === "print_rules")?.columns;
  requireRestore(supplement?.sourceRef === "eyuctbnlvnbnivwasvqr" && supplement.readOnly === true
    && columns && isDeepStrictEqual(columns, supplement.columns), "REFERENCES_INVALID");
  // No named/anonymous host volume, network, provider environment or connection
  // URL can enter this adapter. createdb fails if this copy was already used.
  const execute = (command, args, input) => docker(["exec", "-i", containerId, command, ...args], input);
  const sql = query => execute("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql",
    "-U", "supabase_admin", "-d", database], `set statement_timeout=120000;\n${query}`);
  execute("createdb", ["-h", "/var/run/postgresql", "-U", "supabase_admin", "--template=template0", database]);
  sql(`create schema extensions; ${schemas.filter(schema => !["public", "vault"].includes(schema))
    .map(schema => `create schema ${identifier(schema)};`).join(" ")}
    create extension btree_gist with schema extensions;
    create extension pgcrypto with schema extensions;
    create extension "uuid-ossp" with schema extensions;
    create extension supabase_vault;
    alter schema public owner to pg_database_owner;
    alter schema app_private owner to postgres; alter schema internal owner to postgres;`);
  execute("mkdir", ["-m", "700", "/partial-retirement-proof"]);
  execute("dd", ["of=/partial-retirement-proof/restore.dump", "status=none"], dump);
  const objectList = execute("pg_restore", ["--list", "/partial-retirement-proof/restore.dump"])
    .split("\n").filter(line => !/^\d+; \d+ \d+ SCHEMA - /.test(line)).join("\n");
  execute("dd", ["of=/partial-retirement-proof/restore.list", "status=none"], objectList);
  for (const section of ["pre-data", "data", "post-data"]) {
    const args = restoreArguments(section).map(arg => arg.replace("/out/", "/partial-retirement-proof/")
      .replace("--dbname=postgres", `--dbname=${database}`));
    execute("pg_restore", ["-h", "/var/run/postgresql", "-U", "supabase_admin", ...args]);
    if (section === "data") {
      const parents = JSON.parse(sql("select coalesce(json_agg(json_build_object('printer_id',id,'organization_id',organization_id,'stall_id',stall_id)),'[]') from public.printers;"));
      assertRecoveryRuleSet(supplement.rows, columns, parents);
      const projection = columns.map(identifier).join(",");
      sql(`insert into public.print_rules (${projection}) select ${projection}
        from json_populate_recordset(null::public.print_rules, ${literal(JSON.stringify(supplement.rows))});`);
    }
  }
  // The sole exception is the three separately authenticated offline parents.
  // Every other original row uses the original ordered columns and exact hash.
  const projection = manifest.tables.map(({ schema, name, columns: fields }) => `select json_build_object(
    'table',${literal(`${schema}.${name}`)},'rows',count(*),'digest',
    md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),''))) as fingerprint
    from (select ${fields.map(identifier).join(",")} from ${identifier(schema)}.${identifier(name)}
    ${schema === "public" && name === "print_rules" ? `where id not in (${recoveryIds.map(literal).join(",")})` : ""}) t`).join(" union all ");
  const fingerprints = JSON.parse(sql(`select coalesce(json_agg(t.fingerprint),'[]') as "fingerprint" from (${projection}) t;`));
  requireRestore(isDeepStrictEqual(fingerprints.sort((a, b) => a.table.localeCompare(b.table)), manifest.fingerprints), "DATA_MISMATCH");
  const referenceQuery = `select json_agg(r order by id) from (select ${columns.map(identifier).join(",")}
    from public.print_rules where id in (${recoveryIds.map(literal).join(",")})) r;`;
  const references = JSON.parse(sql(referenceQuery));
  requireRestore(isDeepStrictEqual(references, supplement.rows), "REFERENCES_MISMATCH");
  let privateRemainingData;
  let privateRemainingSchema;
  if (replay) {
    replayCompletedMetadata(sql, manifest.files);
    requireRestore(isDeepStrictEqual(JSON.parse(sql(referenceQuery)), supplement.rows), "REFERENCES_MISMATCH");
    const snapshot = captureRemainingSnapshot(sql, manifest.tables);
    // Private process evidence for the authenticated composition, never a log
    // or uploadable receipt. It has NOT been compared with the retired DR.
    privateRemainingData = { tables: manifest.tables, snapshot: snapshot.data };
    privateRemainingSchema = snapshot.schema;
  }
  return { diagnosticOnly: true, planQualified: false, originalFingerprintsVerified: true,
    tableCount: manifest.tables.length, offlineReferenceRows: 3, remainingDataProven: false,
    ...(replay ? { offlineMetadataReplay: true, replayedStorageObjects: 42, privateRemainingData, privateRemainingSchema } : {}) };
}

function replayCompletedMetadata(sql, files) {
  verifyStorageDeleteGraph(sql);
  requireRestore(Array.isArray(files) && files.length === 42 && files.every(file =>
    typeof file.bucket === "string" && file.bucket.length > 0 && !file.bucket.includes("\0")
    && typeof file.objectPath === "string" && file.objectPath.length > 0 && !file.objectPath.includes("\0")),
  "STORAGE_PATHS_INVALID");
  const paths = files.map(({ bucket, objectPath }) => ({ bucket, objectPath }));
  const canonical = values => values.map(value => JSON.stringify([value.bucket, value.objectPath])).sort();
  const expected = canonical(paths);
  requireRestore(new Set(expected).size === 42, "STORAGE_PATHS_INVALID");
  const original = JSON.parse(sql(`select coalesce(json_agg(json_build_object('bucket',bucket_id,
    'objectPath',name)),'[]') as original_storage_paths from storage.objects;`));
  requireRestore(isDeepStrictEqual(canonical(original), expected), "STORAGE_PATHS_MISMATCH");
  // Only the already-completed metadata operations are modeled here, after
  // exact original fingerprints and the restored DELETE graph have passed.
  // The original delete guard stays active; its approved GUC is transaction-local.
  // No Storage API/file-byte equivalence is claimed by this local model.
  sql(`begin;
    set local role postgres;
    set local storage.allow_delete_query = 'true';
    delete from storage.objects where (bucket_id,name) in
      (select bucket,"objectPath" from json_to_recordset(${literal(JSON.stringify(paths))})
        as p(bucket text,"objectPath" text));
    do $$ begin if exists(select 1 from storage.objects) then
      raise exception 'STAGING_PARTIAL_RESTORE_STORAGE_NOT_EMPTY'; end if; end $$;
    delete from vault.secrets;
    drop schema if exists app_private cascade;
    drop schema if exists internal cascade;
    ${retiredDrSequenceCleanupSql}
    commit;`);
  // Active cron was zero at the authenticated original-data checkpoint. This
  // six-schema backup contains no cron catalog; do not invent or recreate it.
  const readback = JSON.parse(sql(`select json_build_object(
    'files',(select count(*) from storage.objects),'vault',(select count(*) from vault.secrets),
    'privateSchemas',(select count(*) from pg_namespace where nspname in ('app_private','internal')),
    'standaloneSequences',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='S' and not exists(select 1 from pg_depend d
        where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in ('e','a','i')))
    ) as partial_retirement_readback;`));
  requireRestore(isDeepStrictEqual(readback, { files: 0, vault: 0, privateSchemas: 0, standaloneSequences: 0 }),
    "REPLAY_READBACK_MISMATCH");
}

function verifyStorageDeleteGraph(sql) {
  const graph = JSON.parse(sql(`select json_build_object(
    'kind', c.relkind, 'partition', c.relispartition,
    'inheritance', (select count(*) from pg_inherits where inhrelid=c.oid or inhparent=c.oid),
    'incomingForeignKeys', (select count(*) from pg_constraint where confrelid=c.oid),
    'rules', (select count(*) from pg_rewrite where ev_class=c.oid),
    'deleteTriggers', (select coalesce(json_agg(json_build_object(
      'type',t.tgtype,'enabled',t.tgenabled,'arguments',octet_length(t.tgargs),
      'condition',t.tgqual::text,'columns',t.tgattr::text,'schema',n.nspname,'function',p.proname,
      'definition',pg_get_functiondef(p.oid),'securityDefiner',p.prosecdef,'config',p.proconfig)
      order by t.tgname),'[]') from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      join pg_namespace n on n.oid=p.pronamespace where t.tgrelid=c.oid and (t.tgtype & 8)<>0)
    ) as storage_delete_graph from pg_class c where c.oid='storage.objects'::regclass;`));
  requireRestore(graph?.kind === "r" && graph.partition === false && graph.inheritance === 0
    && graph.incomingForeignKeys === 0 && graph.rules === 0 && graph.deleteTriggers?.length === 1,
  "STORAGE_GRAPH_INVALID");
  const trigger = graph.deleteTriggers[0];
  requireRestore(trigger.type === 10 && trigger.enabled === "O" && trigger.arguments === 0
    && trigger.condition === null && trigger.columns === "" && trigger.schema === "storage"
    && trigger.function === "protect_delete" && trigger.securityDefiner === false && trigger.config === null
    && trigger.definition === storageDeleteGuardDefinition, "STORAGE_GRAPH_INVALID");
}

// Exact provider definition observed read-only on 2026-10-23. This must also
// match the ORIGINAL restored catalog; the current hosted catalog is not proof.
const storageDeleteGuardDefinition = `CREATE OR REPLACE FUNCTION storage.protect_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$function$
`;
