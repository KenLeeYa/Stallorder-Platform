import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProtectedPartialReadOnly, summarizePartialReadOnlyObservations } from "./staging-partial-retirement-readonly.mjs";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const repository = "KenLeeYa/Stallorder-Platform";
const path = ".github/workflows/dr-staging-partial-proof.yml";
const sha = "a".repeat(40);
const context = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository, GITHUB_ACTOR: "KenLeeYa",
  GITHUB_TRIGGERING_ACTOR: "KenLeeYa", GITHUB_REF: "refs/heads/main", GITHUB_REF_PROTECTED: "true",
  GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha, GITHUB_WORKFLOW_REF: `${repository}/${path}@refs/heads/main`,
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ID: "50000000000", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_JOB: "readonly-proof", RUNNER_OS: "Linux", GITHUB_TOKEN: "fixture-github-token" };
const self = () => ({ id: 50000000000, run_attempt: 1, head_sha: sha, head_branch: "main", path,
  event: "workflow_dispatch", status: "in_progress", conclusion: null, actor: { login: "KenLeeYa" },
  triggering_actor: { login: "KenLeeYa" }, repository: { full_name: repository, owner: { login: "KenLeeYa" } },
  head_repository: { full_name: repository } });
beforeEach(() => {
  for (const [key, value] of Object.entries(context)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("protected diagnostic entry", () => {
  it("rejects unknown evidence modes before any network without historical fallback", async () => {
    for (const mode of ["auto", "", "consumed-plan-history-v2", "../plan"]) {
      expect(await runProtectedPartialReadOnly({ mode })).toMatchObject({ status: "failed", phase: "mode" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  function observations() {
    const before = {
      sources: { diagnosticOnly: true, planQualified: false, sourceSha: sha, stagingSha: "b".repeat(40), tree: "c".repeat(40),
        currentSourcesMatched: true, mainRemoteReadinessPassed: true, stagingRemoteReadinessClaimed: false, privateSentinel: "source-private" },
      entry: { diagnosticOnly: true, planQualified: false, currentEntryConfigurationMatched: true,
        oldQaTokenAbsent: true, oldQaPolicyAbsent: true, primaryBaselineMatched: true,
        humanAccessAcceptanceProven: false, runtimeAcceptanceProven: false,
        privateCurrentEntry: { policy: "entry-private", primary: "baseline-private" } },
      isolation: { diagnosticOnly: true, planQualified: false, currentDatabaseIsolationObserved: true,
        currentAuthIsolationObserved: true, knownEdgeSettingsMatched: true, independentEdgeCredentialsProven: false,
        sequenceWriterQuiescenceProven: false, privateIsolation: { auth: "auth-private", edge: "edge-private" } },
      security: { diagnosticOnly: true, planQualified: false, currentGlobalSecurityCaptured: true,
        historicalGlobalStateProven: false, currentGlobalSafetyProven: false, privateGlobalSecurity: { roles: "roles-private" } },
    };
    const compared = { originalFingerprintsVerified: true, offlineMetadataReplay: true, remainingTableDataMatched: true,
      remainingCatalogMatched: true, sequenceStateMatched: true, rowCatalogSingleStatement: true,
      sequenceSnapshotAtomic: false, remainingDataProven: false, remainingSchemaProven: false, planQualified: false,
      privateUnexpected: "comparison-private" };
    return { before, after: structuredClone(before), compared };
  }

  it("summarizes matching observations without private payloads or granting full-proof authority", () => {
    const { before, after, compared } = observations();
    const result = summarizePartialReadOnlyObservations(before, after, compared);
    expect(result).toMatchObject({ status: "observed", sourceSha: sha, currentSourcesMatched: true,
      mainRemoteReadinessPassed: true, currentEntryConfigurationMatched: true, oldQaTokenAbsent: true,
      primaryBaselineMatched: true, originalFingerprintsVerified: true, finalReadbackMatched: true });
    for (const key of ["planQualified", "remainingDataProven", "remainingSchemaProven", "stagingRemoteReadinessClaimed",
      "sequenceSnapshotAtomic", "sequenceWriterQuiescenceProven", "historicalGlobalStateProven", "currentGlobalSafetyProven",
      "independentEdgeCredentialsProven", "humanAccessAcceptanceProven", "runtimeAcceptanceProven"]) expect(result[key]).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private|source-private|auth-private|edge-private|roles-private|baseline-private/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects every late source, entry, isolation or global drift and missing private observation", () => {
    for (const [reader, field] of [["sources", "tree"], ["entry", "privateCurrentEntry"],
      ["isolation", "privateIsolation"], ["security", "privateGlobalSecurity"]]) {
      const { before, after, compared } = observations();
      if (reader === "sources") after.sources.tree = "d".repeat(40);
      else after[reader][field][Object.keys(after[reader][field])[0]] = "private-drift";
      expect(() => summarizePartialReadOnlyObservations(before, after, compared)).toThrow(/^STAGING_PARTIAL_READONLY_FAILED$/);
      if (reader !== "sources") {
        delete before[reader][field]; delete after[reader][field];
        expect(() => summarizePartialReadOnlyObservations(before, after, compared)).toThrow(/^STAGING_PARTIAL_READONLY_FAILED$/);
      }
    }
  });

  it("rejects incomplete or escalated evidence rather than projecting hardcoded success", () => {
    for (const field of ["originalFingerprintsVerified", "offlineMetadataReplay", "remainingTableDataMatched",
      "remainingCatalogMatched", "sequenceStateMatched", "rowCatalogSingleStatement", "sequenceSnapshotAtomic",
      "remainingDataProven", "remainingSchemaProven", "planQualified"]) {
      const { before, after, compared } = observations(); compared[field] = !compared[field];
      expect(() => summarizePartialReadOnlyObservations(before, after, compared)).toThrow(/^STAGING_PARTIAL_READONLY_FAILED$/);
    }
    for (const [reader, field] of [["sources", "mainRemoteReadinessPassed"], ["entry", "oldQaPolicyAbsent"],
      ["isolation", "currentAuthIsolationObserved"], ["security", "currentGlobalSecurityCaptured"]]) {
      const { before, after, compared } = observations(); before[reader][field] = false; after[reader][field] = false;
      expect(() => summarizePartialReadOnlyObservations(before, after, compared)).toThrow(/^STAGING_PARTIAL_READONLY_FAILED$/);
    }
    const { before, after, compared } = observations(); before.sources.sourceSha = after.sources.sourceSha = "private-not-a-sha";
    expect(() => summarizePartialReadOnlyObservations(before, after, compared)).toThrow(/^STAGING_PARTIAL_READONLY_FAILED$/);
  });

  it("rejects local, fork, non-owner, wrong workflow, rerun and malformed context before network", async () => {
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "false", GITHUB_REPOSITORY: "other/repo",
      GITHUB_ACTOR: "other", GITHUB_TRIGGERING_ACTOR: "other", GITHUB_REF: "refs/heads/staging",
      GITHUB_REF_PROTECTED: "false", GITHUB_WORKFLOW_REF: `${repository}/other.yml@refs/heads/main`,
      GITHUB_EVENT_NAME: "push", GITHUB_RUN_ATTEMPT: "2", GITHUB_RUN_ID: "../secrets",
      GITHUB_WORKFLOW_SHA: "b".repeat(40), GITHUB_JOB: "conversion", RUNNER_OS: "Windows" })) {
      vi.stubEnv(key, value);
      const result = await runProtectedPartialReadOnly();
      expect(result).toEqual({ diagnosticOnly: true, planQualified: false, remainingDataProven: false,
        remainingSchemaProven: false, status: "failed", phase: "invocation", error: "STAGING_PARTIAL_READONLY_FAILED" });
      vi.stubEnv(key, context[key]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the live current run identity and never leaks API errors or follows redirects", async () => {
    for (const mutation of [r => { r.head_sha = "b".repeat(40); }, r => { r.path = "other"; },
      r => { r.repository.owner.login = "other"; }, r => { r.run_attempt = 2; },
      r => { r.actor.login = "other"; }, r => { r.triggering_actor.login = "other"; },
      r => { r.status = "completed"; }, r => { r.head_repository.full_name = "other/fork"; }]) {
      const run = self(); mutation(run);
      fetch.mockResolvedValue(new Response(JSON.stringify(run)));
      expect(await runProtectedPartialReadOnly()).toMatchObject({ status: "failed", phase: "invocation" });
    }
    for (const status of [302, 401, 403, 429, 500]) {
      fetch.mockResolvedValue(new Response("private credential or provider payload", { status }));
      const result = await runProtectedPartialReadOnly();
      expect(JSON.stringify(result)).not.toMatch(/private|credential|provider payload/);
      expect(result.status).toBe("failed");
    }
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe(`https://api.github.com/repos/${repository}/actions/runs/50000000000`);
      expect(options.method).toBe("GET"); expect(options.redirect).toBe("error");
    }
  });

  it("downloads only fixed raw archives with bounded credential-free signed redirects, rejecting malformed bytes", async () => {
    const calls = [];
    fetch.mockImplementation(async (url, options) => {
      calls.push([url, options]);
      if (url.endsWith("/actions/runs/50000000000")) return Response.json(self());
      if (url.endsWith("/12368487539/zip")) return new Response(null, { status: 302,
        headers: { location: "https://fixture.blob.core.windows.net/private/signed-archive" } });
      if (url.startsWith("https://fixture.blob.core.windows.net/")) return new Response("invalid archive bytes");
      return Response.json({});
    });
    expect(await runProtectedPartialReadOnly()).toMatchObject({ status: "failed", phase: "archives" });
    const signed = calls.find(([url]) => url.startsWith("https://fixture.blob.core.windows.net/"));
    expect(signed).toBeDefined(); expect(signed[1].headers).toBeUndefined();
    expect(signed[1].redirect).toBe("error");
    expect(calls.every(([, options]) => options.method === "GET")).toBe(true);
    expect(calls.some(([url]) => /supabase|vercel|cloudflare/.test(url))).toBe(false);
  });

  it("rejects arbitrary archive redirects, oversized streams and provider errors without retry", async () => {
    for (const location of ["http://fixture.blob.core.windows.net/file", "https://example.invalid/file",
      "https://user:pass@fixture.blob.core.windows.net/file", "https://fixture.blob.core.windows.net:9443/file",
      "https://fixture.blob.core.windows.net/file#fragment"]) {
      fetch.mockClear();
      fetch.mockImplementation(async url => url.endsWith("/50000000000") ? Response.json(self())
        : url.endsWith("/zip") ? new Response(null, { status: 302, headers: { location } }) : Response.json({}));
      expect(await runProtectedPartialReadOnly()).toMatchObject({ status: "failed", phase: "archives" });
      expect(fetch.mock.calls).toHaveLength(4);
    }
    for (const response of [new Response(new Uint8Array(9441388)), new Response("secret", { status: 403 }),
      new Response("secret", { status: 429 }), new Response("secret", { status: 500 })]) {
      fetch.mockClear();
      fetch.mockImplementation(async url => url.endsWith("/50000000000") ? Response.json(self())
        : url.endsWith("/zip") ? response : Response.json({}));
      expect(await runProtectedPartialReadOnly()).toMatchObject({ status: "failed", phase: "archives" });
      expect(fetch.mock.calls).toHaveLength(4);
    }
  });

  it("has a manual protected main-only workflow with no production write capabilities or private uploads", () => {
    const workflow = yaml.load(readFileSync(new URL("../.github/workflows/dr-staging-partial-proof.yml", import.meta.url), "utf8"));
    expect(workflow.on.workflow_dispatch.inputs.evidence_mode).toEqual({
      description: "Explicit evidence transport; never renews the consumed Plan",
      type: "choice", required: true, default: "current-artifact",
      options: ["current-artifact", "consumed-plan-history-v1"],
    });
    expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
    expect(workflow.concurrency).toEqual({ group: "production-dr-operations", "cancel-in-progress": false });
    const job = workflow.jobs["readonly-proof"];
    expect(job.environment).toBe("production");
    expect(job.if).toContain("github.actor == github.repository_owner");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.if).toContain("github.run_attempt == 1");
    expect(job.steps.filter(s => Object.values(s.env ?? {}).some(v => String(v).includes("secrets."))))
      .toHaveLength(1);
    const proof = job.steps.find(s => s.run === "node scripts/staging-partial-retirement-readonly.mjs");
    expect(proof.env.DR_BACKUP_ENCRYPTION_KEY).toBe("${{ secrets.DR_BACKUP_ENCRYPTION_KEY }}");
    expect(proof.env.PARTIAL_PROOF_EVIDENCE_MODE).toBe("${{ inputs.evidence_mode }}");
    expect(proof.env.DR_STAGING_CONSUMED_PLAN_39944190461_ZIP_BASE64).toBe("${{ inputs.evidence_mode == 'consumed-plan-history-v1' && secrets.DR_STAGING_CONSUMED_PLAN_39944190461_ZIP_BASE64 || '' }}");
    expect(job.steps.find(s => s.name === "Validate diagnostic entry and reader contracts").run)
      .toContain("scripts/staging-plan-history.test.mjs");
    expect(JSON.stringify(job)).not.toMatch(/DB_PASSWORD|continue-on-error|download-artifact|supabase db reset|convert-dr-to-staging|production-dr-apply/);
    expect(job.steps.find(s => s.name === "Stop exact isolated copy").if).toBe("always()");
    const create = job.steps.find(s => s.name === "Create fresh isolated copy").run;
    expect(create).toContain('docker_local pull --platform linux/amd64 "$image"');
    expect(create).toContain('docker_local create --platform linux/amd64');
    const uploads = job.steps.filter(s => s.uses === "actions/upload-artifact@v4");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].with.path).toBe("artifacts/partial-proof-public/receipt.json");
    expect(uploads[0].if).toBe("always()");
  });

  it.each(["none", "empty", "invalid-id", "owner", "task", "proof-run", "stop", "running"])(
    "executes exact cleanup against synthetic Docker and preserves ownership/failure boundaries (%s)", fault => {
    const workflow = yaml.load(readFileSync(new URL("../.github/workflows/dr-staging-partial-proof.yml", import.meta.url), "utf8"));
    const script = workflow.jobs["readonly-proof"].steps.find(step => step.name === "Stop exact isolated copy").run;
    const root = resolve(".");
    const directory = mkdtempSync(`${root}/partial-cleanup-test-`);
    const docker = resolve(directory, "docker");
    const calls = resolve(directory, "calls");
    const id = "a".repeat(64);
    const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
    try {
        writeFileSync(calls, "");
        writeFileSync(docker, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$(dirname "$0")/calls"
test "$1" = --host && test "$2" = unix:///var/run/docker.sock
shift 2
if test "$1" = stop; then
  test "$2" = ${id}
  test '${fault}' != stop
  exit
fi
test "$1" = inspect && test "$2" = -f && test "$4" = ${id}
case "$3" in
  *owner*) if test '${fault}' = owner; then echo wrong; else echo dr-staging-transition-20261022; fi ;;
  *task*) if test '${fault}' = task; then echo wrong; else echo staging-partial-retirement-proof; fi ;;
  *proof-run*) if test '${fault}' = proof-run; then echo wrong; else echo 50000000000; fi ;;
  *State.Running*) if test '${fault}' = running; then echo true; else echo false; fi ;;
  *) exit 91 ;;
esac
`);
        chmodSync(docker, 0o700);
        const pathSetup = process.platform === "win32" ? 'PATH="$(cygpath -u "$1"):$PATH"' : 'PATH="$1:$PATH"';
        const child = spawnSync(bash, ["-c", `${pathSetup}; export PATH;\n${script}`, "cleanup-fixture", directory], {
          encoding: "utf8", timeout: 10_000, windowsHide: true,
          env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "SYSTEMROOT"].includes(key.toUpperCase()))),
            GITHUB_RUN_ID: "50000000000", PARTIAL_PROOF_CONTAINER: fault === "empty" ? "" : fault === "invalid-id" ? "other-target" : id },
        });
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(["none", "empty"].includes(fault) ? 0 : 1);
        const commands = readFileSync(calls, "utf8").trim().split("\n").filter(Boolean);
        expect(commands.filter(command => command.includes(" stop "))).toHaveLength(["none", "stop", "running"].includes(fault) ? 1 : 0);
        expect(commands.every(command => command.endsWith(id))).toBe(true);
        expect(commands.some(command => /prune|remove|rm |start |create /.test(command))).toBe(false);
        if (["empty", "invalid-id"].includes(fault)) expect(commands).toHaveLength(0);
    } finally {
      // Only the newly generated fixture directory, never a service or volume.
      if (!/^partial-cleanup-test-[^/\\]+$/.test(relative(root, directory))) throw new Error("UNSAFE_FIXTURE_PATH");
      rmSync(directory, { recursive: true });
    }
  });
});
