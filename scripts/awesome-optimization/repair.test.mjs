import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { main } from "./cli.mjs";
import { scanBoundaries } from "./boundaries.mjs";
import { scopeManifest, manifestHash } from "./scope-manifest.mjs";
import { sourceInputs } from "./source-identity.mjs";
import { summarizeReceipt } from "./runner.mjs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const originalRead = fs.readFileSync.getMockImplementation();
// Captured actual batch receipt/raw outputs are shipped as regression data. Tests do
// not depend on ignored local evidence existing in a fresh Linux/Windows checkout.
const evidenceRoot = ".superpowers/sdd/2026-10-01-awesome-optimization/batch-1/runs";
async function inventory() {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try { await main(["inventory"]); return JSON.parse(output.mock.calls[0][0]); }
  finally { output.mockRestore(); }
}

test.each([
  ["omission", (receipt) => { receipt.checks = receipt.checks.filter((check) => check.status !== "not_run"); }],
  ["downgrade", (receipt) => { receipt.checks.filter((check) => check.status === "not_run").forEach((check) => { check.required = false; }); }],
  ["extra", (receipt) => { receipt.checks.push({ ...receipt.checks[0], id: "extra" }); }],
  ["scope", (receipt) => { receipt.scope = "batch-1"; }],
  ["unknown scope", (receipt) => { receipt.scope = "unknown"; }],
  ["command", (receipt) => { receipt.checks[0].command = [process.execPath, "-e", "process.exit(0)"]; }],
  ["timeout", (receipt) => { receipt.checks[0].timeoutMs = 1; }],
  ["status contradiction", (receipt) => { receipt.status = "passed"; receipt.exitCode = 0; }],
  ["unexecuted claimed passed", (receipt) => { receipt.checks.filter((check) => check.command === null).forEach((check) => { check.status = "passed"; check.exitCode = 0; }); receipt.status = "passed"; receipt.exitCode = 0; }],
])("public report refuses %s while preserving actual logs", async (_label, mutate) => {
  const current = await inventory();
  const receipt = JSON.parse(originalRead("scripts/awesome-optimization/fixtures/batch-1-full-receipt.json", "utf8"));
  receipt.sourceBefore = receipt.sourceAfter = current;
  receipt.manifestSha256 = manifestHash("full");
  receipt.checks = receipt.checks.map((check, index) => ({ ...check, ...scopeManifest("full")[index] }));
  expect(summarizeReceipt(receipt)).toEqual({ status: "incomplete", exitCode: 1 });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const directory = fs.mkdtempSync(join(evidenceRoot, "regression-"));
  const receiptPath = join(directory, "receipt.json").replaceAll("\\", "/");
  for (const check of receipt.checks) fs.writeFileSync(join(directory, `${check.id}.log`), check.output);
  mutate(receipt);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try { expect(await main(["report", `--receipt=${receiptPath}`])).toBe(1); expect(JSON.parse(output.mock.calls[0][0]).status).toBe("invalid"); }
  finally { output.mockRestore(); fs.rmSync(directory, { recursive: true }); }
}, 15000);

test.each(["tsconfig.json", "eslint.config.mjs", "supabase/config.toml", "scripts/responsive-qa-target.mjs", "scripts/responsive-qa-target.test.mjs", "scripts/lib/production-workflow-contract.test.mjs"])("public inventory identity changes with effective input %s", async (path) => {
  const before = await inventory();
  const read = vi.spyOn(fs, "readFileSync").mockImplementation((target, ...args) => {
    const value = originalRead(target, ...args);
    return resolve(String(target)) === resolve(path) ? Buffer.from(`${value}\n// synthetic changed bytes`) : value;
  });
  try { expect((await inventory()).sourceSha256).not.toBe(before.sourceSha256); }
  finally { read.mockRestore(); }
}, 15000);

test("actual baseline accepts LF and CRLF but refuses substantive changes", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "awesome-repair-newlines-"));
  try {
    const baseline = JSON.parse(originalRead("scripts/awesome-optimization/boundary-baseline.json", "utf8"));
    const paths = Object.keys(baseline[0].sourceHashes);
    for (const path of [...paths, "scripts/awesome-optimization/boundary-baseline.json"]) { fs.mkdirSync(join(root, path, ".."), { recursive: true }); fs.writeFileSync(join(root, path), originalRead(path)); }
    for (const newline of ["\n", "\r\n"]) {
      for (const path of paths) fs.writeFileSync(join(root, path), originalRead(path, "utf8").replaceAll("\r\n", "\n").replaceAll("\n", newline));
      expect(scanBoundaries(root).findings).toEqual([]); expect(scanBoundaries(root).baselineDebt).toHaveLength(1);
    }
    fs.appendFileSync(join(root, paths[0]), "\n// substantive change");
    expect(scanBoundaries(root).baselineDebt).toEqual([]); expect(scanBoundaries(root).findings.length).toBeGreaterThan(0);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test.each(["// header\n", "/* header */\n", "\uFEFF// header\n", '"use strict";\n/* header */\n'])("AST client directive follows %j", (prefix) => {
  const root = fs.mkdtempSync(join(tmpdir(), "awesome-repair-directive-"));
  try {
    fs.mkdirSync(join(root, "src"));
    fs.writeFileSync(join(root, "src/client.tsx"), `${prefix}"use client"; import "server-only"; process.env.NEXT_PUBLIC_ACCESS_TOKEN;`);
    const result = scanBoundaries(root);
    expect(result.entries).toBe(1); expect(result.findings.map((finding) => finding.classification)).toContain("SERVER_DEPENDENCY_IN_CLIENT");
    expect(result.findings.map((finding) => finding.classification)).toContain("PUBLIC_SECRET_PREFIX");
    fs.writeFileSync(join(root, "src/client.tsx"), 'function nested() { "use client"; } import "server-only";');
    expect(scanBoundaries(root).entries).toBe(0);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test.each(["tsconfig.json", "eslint.config.mjs", "supabase/config.toml", "scripts/responsive-qa-target.mjs", "scripts/lib/imported-helper.mjs", "supabase/migrations/synthetic.sql"])("input inventory binds create/change/delete of %s and excludes env values", (path) => {
  const root = fs.mkdtempSync(join(tmpdir(), "awesome-repair-inputs-"));
  try {
    const before = sourceInputs(root);
    fs.mkdirSync(join(root, path, ".."), { recursive: true });
    fs.writeFileSync(join(root, path), "synthetic original bytes");
    const created = sourceInputs(root);
    expect(created.sourceSha256).not.toBe(before.sourceSha256);
    expect(created.inputs.some((input) => input.path === path && input.sha256)).toBe(true);
    fs.writeFileSync(join(root, path), "synthetic changed bytes");
    expect(sourceInputs(root).sourceSha256).not.toBe(created.sourceSha256);
    fs.unlinkSync(join(root, path));
    expect(sourceInputs(root).sourceSha256).toBe(before.sourceSha256);
    fs.writeFileSync(join(root, ".env.local"), "PRIVATE_KEY=synthetic-secret-not-hashed");
    expect(sourceInputs(root).sourceSha256).toBe(before.sourceSha256);
    expect(JSON.stringify(sourceInputs(root))).not.toContain("synthetic-secret");
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("recognized batch scope can pass only with exact executed recipes; contradictions fail", () => {
  const checks = scopeManifest("batch-1").map((check) => ({ ...check, status: "passed", exitCode: 0, output: "", durationMs: 1 }));
  const receipt = { schemaVersion: 1, scope: "batch-1", manifestSha256: manifestHash("batch-1"), status: "passed", exitCode: 0, checks, sourceBefore: { sourceSha256: "a".repeat(64) }, sourceAfter: { sourceSha256: "a".repeat(64) }, overallProductStatus: "INCOMPLETE", activationStatus: "NOT_ACTIVATED" };
  expect(summarizeReceipt(receipt)).toEqual({ status: "passed", exitCode: 0 });
  for (const mutate of [
    (copy) => { copy.checks[1] = copy.checks[0]; },
    (copy) => { copy.checks.reverse(); },
    (copy) => { copy.checks[0].status = "failed"; },
    (copy) => { copy.checks[0].status = "missing"; },
    (copy) => { copy.checks[0].status = "not_run"; copy.checks[0].exitCode = null; },
    (copy) => { copy.checks[0].exitCode = 9; },
    (copy) => { copy.schemaVersion = 2; },
    (copy) => { copy.exitCode = 1; },
    (copy) => { delete copy.sourceBefore; },
  ]) { const copy = structuredClone(receipt); mutate(copy); expect(summarizeReceipt(copy)).toEqual({ status: "invalid", exitCode: 1 }); }
});

test("public report reads complete scoped receipts and unchanged physical raw logs", async () => {
  const current = await inventory();
  const original = JSON.parse(originalRead("scripts/awesome-optimization/fixtures/batch-1-full-receipt.json", "utf8"));
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const directory = fs.mkdtempSync(join(evidenceRoot, "regression-"));
  const receiptPath = join(directory, "receipt.json").replaceAll("\\", "/");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    for (const scope of ["full", "batch-1"]) {
      const receipt = { ...original, scope, manifestSha256: manifestHash(scope), sourceBefore: current, sourceAfter: current, status: scope === "full" ? "incomplete" : "passed", exitCode: scope === "full" ? 1 : 0,
        checks: scopeManifest(scope).map((recipe, index) => ({ ...original.checks[index], ...recipe })) };
      for (const check of receipt.checks) fs.writeFileSync(join(directory, `${check.id}.log`), check.output);
      fs.writeFileSync(receiptPath, JSON.stringify(receipt)); output.mockClear();
      expect(await main(["report", `--receipt=${receiptPath}`])).toBe(receipt.exitCode);
      expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ status: receipt.status, matchingSource: true, logsMatch: true });
    }
  } finally { output.mockRestore(); fs.rmSync(directory, { recursive: true }); }
}, 20000);

test("commented server directives exclude browser RPC edges but never native server dependencies", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "awesome-repair-server-directive-"));
  try {
    fs.mkdirSync(join(root, "src")); fs.mkdirSync(join(root, "apps/mobile"), { recursive: true });
    fs.writeFileSync(join(root, "src/client.ts"), '"use client"; import "./action";');
    fs.writeFileSync(join(root, "src/action.ts"), '\uFEFF/* header */ "use strict"; "use server"; import "@prisma/client";');
    expect(scanBoundaries(root).findings).toEqual([]);
    fs.writeFileSync(join(root, "apps/mobile/action.ts"), '\uFEFF/* header */ "use strict"; "use server"; import "@prisma/client";');
    expect(scanBoundaries(root).findings).toHaveLength(1);
    fs.writeFileSync(join(root, "src/client.ts"), 'const text = "use client"; import "server-only";');
    expect(scanBoundaries(root).entries).toBe(1); // only the native entry, not the string value
  } finally { fs.rmSync(root, { recursive: true }); }
});
