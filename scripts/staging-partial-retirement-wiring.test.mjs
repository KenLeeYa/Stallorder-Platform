// Composition fixtures only: no network, provider, database, container or app service.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ events: [], invocation: vi.fn(), archive: vi.fn(), history: vi.fn(),
  git: vi.fn(), sources: vi.fn(), entry: vi.fn(), isolation: vi.fn(), security: vi.fn(), compare: vi.fn() }));
vi.mock("./staging-partial-retirement-transport.mjs", () => ({
  assertPartialProofInvocation: mocks.invocation, readPartialProofArchive: mocks.archive, readPartialProofGithub: vi.fn(),
}));
vi.mock("./staging-plan-history.mjs", () => ({ readProtectedPlanHistoryInputs: mocks.history }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.git }));
vi.mock("./staging-partial-retirement-sources.mjs", () => ({ readCurrentPartialSources: mocks.sources }));
vi.mock("./staging-partial-retirement-entry.mjs", () => ({ readCurrentPartialEntry: mocks.entry }));
vi.mock("./staging-partial-retirement-isolation.mjs", () => ({ readCurrentPartialIsolation: mocks.isolation }));
vi.mock("./staging-partial-retirement-security.mjs", () => ({ readCurrentPartialSecurity: mocks.security }));
vi.mock("./staging-partial-retirement-backup.mjs", () => ({ compareOriginalPartialProofData: mocks.compare }));
import { runProtectedPartialReadOnly } from "./staging-partial-retirement-readonly.mjs";

const mode = "consumed-plan-history-v1";
const retirement = { mode, planZip: Buffer.from("private-original-plan"), applyZip: Buffer.from("private-apply"),
  applyJob: { id: 120384090004 }, workflowDocument: { content: "private-workflow" } };
const backup = { zip: Buffer.from("private-encrypted-backup") };
const summary = { historicalProvenanceValidated: true, originalPlanConsumed: true,
  originalApprovalExpired: true, applyAuthorized: false, backupDecrypted: false, privateUnexpected: "private-history" };
const base = { diagnosticOnly: true, planQualified: false };
const sources = { ...base, currentSourcesMatched: true, mainRemoteReadinessPassed: true,
  stagingRemoteReadinessClaimed: false, sourceSha: "a".repeat(40), stagingSha: "b".repeat(40), tree: "c".repeat(40) };
const entry = { ...base, currentEntryConfigurationMatched: true, oldQaTokenAbsent: true, oldQaPolicyAbsent: true,
  primaryBaselineMatched: true, privateCurrentEntry: { sentinel: "private-entry" } };
const isolation = { ...base, currentDatabaseIsolationObserved: true, currentAuthIsolationObserved: true,
  knownEdgeSettingsMatched: true, privateIsolation: { sentinel: "private-isolation" } };
const security = { ...base, currentGlobalSecurityCaptured: true, privateGlobalSecurity: { sentinel: "private-security" } };
const compared = { ...base, originalFingerprintsVerified: true, offlineMetadataReplay: true, remainingTableDataMatched: true,
  remainingCatalogMatched: true, sequenceStateMatched: true, rowCatalogSingleStatement: true,
  sequenceSnapshotAtomic: false, remainingDataProven: false, remainingSchemaProven: false, privateUnexpected: "private-rows" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.events.length = 0;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No actual network permitted"); }));
  vi.stubEnv("DR_BACKUP_ENCRYPTION_KEY", "fixture-only-not-real");
  vi.stubEnv("PARTIAL_PROOF_CONTAINER", "fixture-container-not-real");
  for (const [name, result] of Object.entries({ invocation: undefined, history: { retirement, backup, summary },
    git: "", sources, entry, isolation, security, compare: compared })) {
    mocks[name].mockImplementation(() => { mocks.events.push(name); return structuredClone(result); });
  }
  // Preserve raw bundle object identity to catch omitted/reconstructed handoffs.
  mocks.history.mockImplementation(() => { mocks.events.push("history"); return { retirement, backup, summary }; });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("composes explicit historical transport with BOTH entry reads and original backup comparison", async () => {
  const result = await runProtectedPartialReadOnly({ mode });
  expect(result).toMatchObject({ status: "observed", evidenceMode: mode, originalPlanConsumed: true,
    originalApprovalExpired: true, originalArtifactAvailabilityClaimed: false, applyAuthorized: false,
    planQualified: false, remainingDataProven: false, remainingSchemaProven: false, remoteWrites: false });
  expect(mocks.history).toHaveBeenCalledWith({ mode });
  expect(mocks.entry).toHaveBeenCalledTimes(2);
  for (const [input] of mocks.entry.mock.calls) expect(input).toBe(retirement);
  expect(mocks.compare.mock.calls[0][0].retirement).toBe(retirement);
  expect(mocks.compare.mock.calls[0][0].backup.zip).toBe(backup.zip);
  expect(mocks.compare.mock.calls[0][0].containerId).toBe("fixture-container-not-real");
  expect(mocks.events).toEqual(["invocation", "history", "git", "sources", "entry", "isolation", "security",
    "compare", "sources", "entry", "isolation", "security", "invocation"]);
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/private|fixture|planZip|applyZip|workflowDocument|backupDecrypted/);
});

it("keeps current-artifact as default even when a history secret is present; never falls back", async () => {
  vi.stubEnv("DR_STAGING_CONSUMED_PLAN_39944190461_ZIP_BASE64", "private-unused");
  mocks.archive.mockRejectedValue(new Error("private missing artifact"));
  for (const options of [undefined, { mode: "current-artifact" }]) {
    expect(await runProtectedPartialReadOnly(options)).toMatchObject({ status: "failed", phase: "archives" });
  }
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.entry).not.toHaveBeenCalled();
  expect(mocks.compare).not.toHaveBeenCalled();
});

it.each(["invocation", "history", "git", "sources", "entry", "isolation", "security", "compare"])(
  "fails closed on %s without fallback or later comparison", async name => {
    mocks[name].mockImplementationOnce(() => { mocks.events.push(name); throw new Error("private-sensitive-failure"); });
    const result = await runProtectedPartialReadOnly({ mode });
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(mocks.archive).not.toHaveBeenCalled();
    if (name !== "compare") expect(mocks.compare).not.toHaveBeenCalled();
  });

it.each(["sources", "entry", "isolation", "security", "invocation"])(
  "rejects late %s failure after comparison", async name => {
    mocks[name].mockImplementationOnce(() => structuredClone({ sources, entry, isolation, security }[name]));
    mocks[name].mockImplementationOnce(() => { throw new Error("private-late-drift"); });
    expect(await runProtectedPartialReadOnly({ mode })).toMatchObject({ status: "failed", phase: "final-readback" });
    expect(mocks.compare).toHaveBeenCalledOnce();
  });

it("rejects a shape-valid changed final entry and never publishes observed", async () => {
  mocks.entry.mockResolvedValueOnce(entry).mockResolvedValueOnce({ ...entry, privateCurrentEntry: { sentinel: "changed" } });
  expect(await runProtectedPartialReadOnly({ mode })).toMatchObject({ status: "failed", phase: "final-readback" });
});

it("cannot turn historical summary flags into Apply authority", async () => {
  mocks.history.mockResolvedValueOnce({ retirement, backup, summary: { ...summary, applyAuthorized: true } });
  expect(await runProtectedPartialReadOnly({ mode })).toMatchObject({ status: "failed", phase: "final-readback" });
});
