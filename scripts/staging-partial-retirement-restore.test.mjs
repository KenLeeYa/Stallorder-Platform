import { beforeEach, describe, expect, it, vi } from "vitest";
import { restorePartialProofCopy, restoreAndReplayPartialProofCopy } from "./staging-partial-retirement-restore.mjs";

const subprocess = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: subprocess }));
const containerId = "a".repeat(64);
const target = { Id: containerId, Name: "/dr-staging-partial-proof-fixture", State: { Running: true },
  Image: "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
  NetworkSettings: { Ports: { "5432/tcp": null } },
  Config: { Image: "public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453",
    Labels: { owner: "dr-staging-transition-20261022", task: "staging-partial-retirement-proof" } },
  HostConfig: { NetworkMode: "none", PortBindings: {}, Privileged: false }, Mounts: [] };
const columns = ["id", "printer_id", "organization_id", "stall_id"];
const parent = { printer_id: "fixture-printer", organization_id: "fixture-org", stall_id: "fixture-stall" };
const supplement = { sourceRef: "eyuctbnlvnbnivwasvqr", readOnly: true, columns,
  rows: ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896",
    "f66584a9-6357-4422-8cda-40c8a13c259d"].map(id => ({ id, ...parent })) };
const fingerprints = [{ table: "public.print_rules", rows: 0, digest: "d41d8cd98f00b204e9800998ecf8427e" }];
const storageGraph = { kind: "r", partition: false, inheritance: 0, incomingForeignKeys: 0, rules: 0,
  deleteTriggers: [{ type: 10, enabled: "O", arguments: 0, condition: null, columns: "", schema: "storage",
    function: "protect_delete", securityDefiner: false, config: null,
    definition: `CREATE OR REPLACE FUNCTION storage.protect_delete()
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
` }] };
const files = Array.from({ length: 42 }, (_, i) => ({ bucket: "fixture", objectPath: `path-${i}` }));
function fixture() {
  return { containerId, dump: Buffer.from("PGDMPsynthetic"), supplement: structuredClone(supplement),
    manifest: { tables: [{ schema: "public", name: "print_rules", columns }], fingerprints } };
}
function healthyCommands(_command, args, options) {
  if (args.includes("inspect")) return { status: 0, stdout: JSON.stringify([target]) };
  if (args.includes("--list")) return { status: 0, stdout: "1; 1 1 SCHEMA - public postgres\n2; 1 2 TABLE public print_rules postgres\n3; 1 3 FK CONSTRAINT public jobs_rule_fkey postgres" };
  const sql = String(options.input ?? "");
  if (sql.includes("from public.printers")) return { status: 0, stdout: JSON.stringify([parent]) };
  if (sql.includes('as "fingerprint"')) return { status: 0, stdout: JSON.stringify(fingerprints) };
  if (sql.includes("json_agg(r order by id)")) return { status: 0, stdout: JSON.stringify(supplement.rows) };
  if (sql.includes("storage_delete_graph")) return { status: 0, stdout: JSON.stringify(storageGraph) };
  if (sql.includes("original_storage_paths")) return { status: 0, stdout: JSON.stringify(files) };
  if (sql.includes("partial_retirement_readback")) return { status: 0, stdout: JSON.stringify({ files: 0, vault: 0, privateSchemas: 0, standaloneSequences: 0 }) };
  if (sql.includes("as remaining_snapshot from")) return { status: 0, stdout: JSON.stringify({
    data: JSON.parse(healthyCommands(_command, args, { input: "as remaining_data;" }).stdout),
    schema: JSON.parse(healthyCommands(_command, args, { input: "as remaining_schema;" }).stdout),
  }) };
  if (sql.includes("as remaining_data;")) return { status: 0, stdout: JSON.stringify({
    inventory: [{ schema: "public", name: "print_rules", columns, kind: "r", partition: false, inheritance: 0 }],
    fingerprints, offlineReferences: 3, retiredSchemas: 0 }) };
  if (sql.includes("as remaining_schema;")) return { status: 0, stdout: JSON.stringify({ version: 1,
    serverMajor: 17, searchPath: '"$user", public', retiredSchemas: 0, unsupported: 0,
    objects: [{ kind: "schema", identity: "public", definition: { owner: "postgres" } }],
    dependencies: [], sharedDependencies: [], sequences: [], sequenceStates: [] }) };
  return { status: 0, stdout: "" };
}

describe("isolated partial-retirement restore boundary", () => {
  beforeEach(() => { subprocess.mockReset(); });

  it("accepts only the pinned image reference and its verified Desktop or classic amd64 image identity", () => {
    for (const image of [target.Image, "sha256:2d3ac69ad5c95d81458cc93a6cc6c31a98dfa00cd28f88a0a9358d315e1c357a"]) {
      subprocess.mockImplementation((command, args, options) => args.includes("inspect")
        ? { status: 0, stdout: JSON.stringify([{ ...target, Image: image }]) } : healthyCommands(command, args, options));
      expect(restorePartialProofCopy(fixture()).originalFingerprintsVerified).toBe(true);
    }
    for (const configImage of [undefined, "public.ecr.aws/supabase/postgres:latest", "other/image@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453"]) {
      subprocess.mockReset().mockReturnValue({ status: 0, stdout: JSON.stringify([
        { ...target, Config: { ...target.Config, Image: configImage } }]) });
      expect(() => restorePartialProofCopy(fixture())).toThrow("STAGING_PARTIAL_RESTORE_TARGET_INVALID");
      expect(subprocess).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a networked target before sending any original archive bytes or SQL", () => {
    subprocess.mockReturnValue({ status: 0, stdout: JSON.stringify([{ Id: containerId,
      Name: "/dr-staging-partial-proof-fixture", State: { Running: true },
      Config: { Labels: { owner: "dr-staging-transition-20261022", task: "staging-partial-retirement-proof" } },
      HostConfig: { NetworkMode: "bridge", PortBindings: {}, Privileged: false }, Mounts: [] }]) });
    expect(() => restorePartialProofCopy({ containerId, dump: Buffer.from("private original archive") }))
      .toThrow("STAGING_PARTIAL_RESTORE_TARGET_INVALID");
    expect(subprocess).toHaveBeenCalledTimes(1);
    expect(subprocess.mock.calls[0][1]).toContain("inspect");
    expect(subprocess.mock.calls[0][2].input).toBeUndefined();
  });

  it("restores every section and original FK/ACLs with only the three offline parents, without exposing provider credentials", () => {
    subprocess.mockImplementation(healthyCommands);
    vi.stubEnv("PGHOST", "hosted.invalid");
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "private-sentinel");
    vi.stubEnv("DOCKER_HOST", "tcp://remote.invalid:2375");
    try {
      expect(restorePartialProofCopy(fixture())).toEqual({ diagnosticOnly: true, planQualified: false,
        originalFingerprintsVerified: true, tableCount: 1, offlineReferenceRows: 3, remainingDataProven: false });
      const calls = subprocess.mock.calls;
      const restores = calls.filter(([, args]) => args.includes("pg_restore") && !args.includes("--list"));
      expect(restores.map(([, args]) => args.find(arg => arg.startsWith("--section="))))
        .toEqual(["--section=pre-data", "--section=data", "--section=post-data"]);
      for (const [, args, options] of calls) {
        expect(args).not.toEqual(expect.arrayContaining(["--no-owner", "--no-acl"]));
        expect(options.env).not.toHaveProperty("PGHOST");
        expect(options.env).not.toHaveProperty("SUPABASE_ACCESS_TOKEN");
        expect(options.env).not.toHaveProperty("DOCKER_HOST");
      }
      const listCopy = calls.find(([, args]) => args.includes("of=/partial-retirement-proof/restore.list"));
      expect(String(listCopy[2].input)).toContain("FK CONSTRAINT public jobs_rule_fkey");
      expect(String(listCopy[2].input)).not.toContain("SCHEMA - public");
      const insertIndex = calls.findIndex(([, , options]) => String(options.input).includes("insert into public.print_rules"));
      expect(insertIndex).toBeGreaterThan(calls.indexOf(restores[1]));
      expect(insertIndex).toBeLessThan(calls.indexOf(restores[2]));
    } finally { vi.unstubAllEnvs(); }
  });

  it("rejects host namespaces, devices, capabilities, mounts and published ports before a local write", () => {
    for (const change of [{ PidMode: "host" }, { IpcMode: "host" }, { CapAdd: ["SYS_ADMIN"] },
      { Devices: [{ PathOnHost: "/dev/sda" }] }, { Privileged: true }, { PortBindings: { "5432/tcp": [{}] } }]) {
      subprocess.mockReset().mockReturnValue({ status: 0, stdout: JSON.stringify([
        { ...target, HostConfig: { ...target.HostConfig, ...change } }]) });
      expect(() => restorePartialProofCopy(fixture())).toThrow("STAGING_PARTIAL_RESTORE_TARGET_INVALID");
      expect(subprocess).toHaveBeenCalledTimes(1);
    }
    subprocess.mockReset().mockReturnValue({ status: 0, stdout: JSON.stringify([
      { ...target, Mounts: [{ Type: "volume", Destination: "/var/lib/postgresql/data" }] }]) });
    expect(() => restorePartialProofCopy(fixture())).toThrow("STAGING_PARTIAL_RESTORE_TARGET_INVALID");
    expect(subprocess).toHaveBeenCalledTimes(1);
  });

  it("never exposes malformed subprocess JSON or original private content in an error", () => {
    subprocess.mockImplementation((command, args, options) => {
      if (String(options.input).includes('as "fingerprint"')) return { status: 0, stdout: "private-row-sentinel invalid JSON" };
      return healthyCommands(command, args, options);
    });
    expect(() => restorePartialProofCopy(fixture())).toThrow(/^STAGING_PARTIAL_RESTORE_FAILED$/);
  });

  it.each([{ status: 1 }, { status: null, error: { code: "ENOENT" } },
    { status: 0, error: { code: "EIO" } }])("stops at a failed section without retry, replay or verification (%j)", result => {
    subprocess.mockImplementation((command, args, options) => args.includes("--section=data")
      ? { ...result, stdout: "private output", stderr: "private SQL" } : healthyCommands(command, args, options));
    expect(() => restorePartialProofCopy(fixture())).toThrow(/^STAGING_PARTIAL_RESTORE_COMMAND_FAILED$/);
    const args = subprocess.mock.calls.map(([, args]) => args);
    expect(args.filter(args => args.includes("--section=data"))).toHaveLength(1);
    expect(args.some(args => args.includes("--section=post-data"))).toBe(false);
  });

  it("rejects arbitrary parent references without inserting them or weakening original FK validation", () => {
    subprocess.mockImplementation(healthyCommands);
    const input = fixture(); input.supplement.rows[0].organization_id = "another-tenant";
    expect(() => restorePartialProofCopy(input)).toThrow(/^STAGING_PARTIAL_RESTORE_FAILED$/);
    expect(subprocess.mock.calls.some(([, , options]) => String(options.input).includes("insert into public.print_rules"))).toBe(false);
  });

  it("rejects any missing or changed original source-column fingerprint", () => {
    for (const returned of [[], [{ ...fingerprints[0], rows: 1 }], [{ ...fingerprints[0], digest: "0".repeat(32) }]]) {
      subprocess.mockImplementation((command, args, options) => String(options.input).includes('as "fingerprint"')
        ? { status: 0, stdout: JSON.stringify(returned) } : healthyCommands(command, args, options));
      expect(() => restorePartialProofCopy(fixture())).toThrow(/^STAGING_PARTIAL_RESTORE_DATA_MISMATCH$/);
    }
  });

  it("independently reads back the three exception rows instead of excluding them unchecked", () => {
    subprocess.mockImplementation((command, args, options) => String(options.input).includes("json_agg(r order by id)")
      ? { status: 0, stdout: JSON.stringify(supplement.rows.slice(1)) } : healthyCommands(command, args, options));
    expect(() => restorePartialProofCopy(fixture())).toThrow(/^STAGING_PARTIAL_RESTORE_REFERENCES_MISMATCH$/);
  });

  it("requires the pinned image and rejects an automatically published host port", () => {
    for (const changes of [{ Image: "sha256:unreviewed" }, { NetworkSettings: { Ports: { "5432/tcp": [{ HostPort: "5432" }] } } }]) {
      subprocess.mockImplementation((command, args, options) => args.includes("inspect")
        ? { status: 0, stdout: JSON.stringify([{ ...target, ...changes }]) } : healthyCommands(command, args, options));
      expect(() => restorePartialProofCopy(fixture())).toThrow(/^STAGING_PARTIAL_RESTORE_TARGET_INVALID$/);
    }
  });

  it("refuses a restored Storage delete graph with an additional cascading foreign key before replay", () => {
    subprocess.mockImplementation((command, args, options) => String(options.input).includes("storage_delete_graph")
      ? { status: 0, stdout: JSON.stringify({ incomingForeignKeys: 1 }) } : healthyCommands(command, args, options));
    const input = fixture();
    input.manifest.files = Array.from({ length: 42 }, (_, i) => ({ bucket: "fixture", objectPath: `path-${i}` }));
    expect(() => restoreAndReplayPartialProofCopy(input)).toThrow(/^STAGING_PARTIAL_RESTORE_STORAGE_GRAPH_INVALID$/);
    expect(subprocess.mock.calls.some(([, , options]) => /delete from|drop schema/.test(String(options.input)))).toBe(false);
  });

  it("replays only authenticated completed metadata retirement on the fresh isolated copy, with no reset or proof of hosted equivalence", () => {
    subprocess.mockImplementation(healthyCommands);
    const input = fixture(); input.manifest.files = files;
    const result = restoreAndReplayPartialProofCopy(input);
    expect(result).toMatchObject({ diagnosticOnly: true, planQualified: false, remainingDataProven: false,
      offlineMetadataReplay: true, replayedStorageObjects: 42 });
    expect(result.privateRemainingData).toEqual({ tables: input.manifest.tables, snapshot: {
      inventory: [{ ...input.manifest.tables[0], kind: "r", partition: false, inheritance: 0 }],
      fingerprints, offlineReferences: 3, retiredSchemas: 0 } });
    expect(result.privateRemainingSchema).toMatchObject({ version: 1, unsupported: 0, sequenceStates: [] });
    const commands = subprocess.mock.calls.map(([, , options]) => String(options.input ?? ""));
    expect(commands.filter(text => text.includes("as remaining_snapshot from"))).toHaveLength(1);
    expect(commands.filter(text => text.includes("as remaining_data;"))).toHaveLength(0);
    const replay = commands.find(text => text.includes("delete from storage.objects"));
    expect(replay).toContain("set local storage.allow_delete_query = 'true'");
    expect(replay).toContain("delete from vault.secrets");
    expect(replay).toContain("drop schema if exists app_private cascade");
    expect(replay).toContain("drop schema if exists internal cascade");
    expect(replay).not.toMatch(/truncate|disable trigger|session_replication_role|db reset|seed|alter_job/i);
    expect(replay).toContain('"path-41"');
    expect(replay).toContain("begin;");
    expect(replay).toContain("commit;");
  });

  it("rejects any restored DELETE side effect or guard weakening before metadata retirement", () => {
    const cases = [
      { ...storageGraph, inheritance: 1 }, { ...storageGraph, partition: true },
      { ...storageGraph, rules: 1 }, { ...storageGraph, deleteTriggers: [] },
      { ...storageGraph, deleteTriggers: [...storageGraph.deleteTriggers, storageGraph.deleteTriggers[0]] },
      ...[{ type: 11 }, { enabled: "D" }, { arguments: 1 }, { condition: "true" }, { columns: "1" },
        { securityDefiner: true }, { config: ["search_path=public"] }, { definition: "private changed body" }]
        .map(change => ({ ...storageGraph, deleteTriggers: [{ ...storageGraph.deleteTriggers[0], ...change }] })),
    ];
    for (const graph of cases) {
      subprocess.mockReset().mockImplementation((command, args, options) => String(options.input).includes("storage_delete_graph")
        ? { status: 0, stdout: JSON.stringify(graph) } : healthyCommands(command, args, options));
      expect(() => restoreAndReplayPartialProofCopy({ ...fixture(), manifest: { ...fixture().manifest, files } }))
        .toThrow(/^STAGING_PARTIAL_RESTORE_STORAGE_GRAPH_INVALID$/);
      expect(subprocess.mock.calls.some(([, , options]) => String(options.input).includes("delete from storage.objects"))).toBe(false);
    }
  });

  it("requires exactly the original Storage paths and rejects extra, missing, duplicate or changed metadata", () => {
    for (const paths of [files.slice(1), [...files, { bucket: "extra", objectPath: "extra" }],
      files.map((file, i) => i === 0 ? { ...file, objectPath: "changed" } : file)]) {
      subprocess.mockReset().mockImplementation((command, args, options) => String(options.input).includes("original_storage_paths")
        ? { status: 0, stdout: JSON.stringify(paths) } : healthyCommands(command, args, options));
      expect(() => restoreAndReplayPartialProofCopy({ ...fixture(), manifest: { ...fixture().manifest, files } }))
        .toThrow(/^STAGING_PARTIAL_RESTORE_STORAGE_PATHS_MISMATCH$/);
      expect(subprocess.mock.calls.some(([, , options]) => String(options.input).includes("delete from storage.objects"))).toBe(false);
    }
    subprocess.mockImplementation(healthyCommands);
    expect(() => restoreAndReplayPartialProofCopy({ ...fixture(), manifest: { ...fixture().manifest, files: Array(42).fill(files[0]) } }))
      .toThrow(/^STAGING_PARTIAL_RESTORE_STORAGE_PATHS_INVALID$/);
  });

  it("stops without retry or success claims when replay or its independent readback fails", () => {
    for (const stage of ["command", "readback", "malformed"]) {
      subprocess.mockReset().mockImplementation((command, args, options) => {
        const query = String(options.input);
        if (stage === "command" && query.includes("delete from storage.objects")) return { status: 1, stderr: "private SQL", stdout: "" };
        if (query.includes("partial_retirement_readback")) return { status: 0, stdout: stage === "malformed"
          ? "private non-json" : JSON.stringify({ files: 1, vault: 0, privateSchemas: 0, standaloneSequences: 0 }) };
        return healthyCommands(command, args, options);
      });
      expect(() => restoreAndReplayPartialProofCopy({ ...fixture(), manifest: { ...fixture().manifest, files } }))
        .toThrow(new RegExp(`^STAGING_PARTIAL_RESTORE_${stage === "command" ? "COMMAND_FAILED" : stage === "readback" ? "REPLAY_READBACK_MISMATCH" : "FAILED"}$`));
      expect(subprocess.mock.calls.filter(([, , options]) => String(options.input).includes("delete from storage.objects"))).toHaveLength(1);
    }
  });

  it("rechecks the offline exception rows after retirement before deriving remaining fingerprints", () => {
    let reads = 0;
    subprocess.mockImplementation((command, args, options) => {
      if (String(options.input).includes("json_agg(r order by id)") && ++reads === 2) {
        return { status: 0, stdout: JSON.stringify(supplement.rows.slice(1)) };
      }
      return healthyCommands(command, args, options);
    });
    expect(() => restoreAndReplayPartialProofCopy({ ...fixture(), manifest: { ...fixture().manifest, files } }))
      .toThrow(/^STAGING_PARTIAL_RESTORE_REFERENCES_MISMATCH$/);
    expect(subprocess.mock.calls.some(([, , options]) => String(options.input).includes("as remaining_snapshot from"))).toBe(false);
  });
});
