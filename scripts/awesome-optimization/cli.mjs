import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runChecks, summarizeReceipt } from "./runner.mjs";
import { sourceFiles } from "./boundaries.mjs";
import { sourceInputs } from "./source-identity.mjs";
import { scopeManifest, manifestHash } from "./scope-manifest.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true }).trim();
const evidenceRoot = ".superpowers/sdd/2026-10-01-awesome-optimization/batch-1/runs";

export function externalStatus(environment) {
  const names = ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "POSTHOG_API_KEY", "NOVU_API_KEY", "TRIGGER_SECRET_KEY", "MEILISEARCH_API_KEY", "OTEL_EXPORTER_OTLP_ENDPOINT"];
  const mode = environment.AWESOME_EXTERNAL_MODE ?? "local-mock";
  return { mode: mode === "local-mock" ? "local-mock" : "refused", activationStatus: "DISABLED_PENDING_APPROVAL", networkCalls: 0,
    settings: Object.fromEntries(names.map((name) => [name, environment[name]?.trim() ? "PRESENT" : "MISSING"])),
    exitCode: mode === "local-mock" ? 0 : 1 };
}

function sourceIdentity() {
  return { head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), ...sourceInputs(root) };
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...options] = args;
  if (resolve(process.cwd()) !== root || options.some((option) => !/^--(?:scope=(?:batch-1|full)|receipt=[a-zA-Z0-9_./-]+)$/u.test(option))) throw new Error("INVALID_WORKSPACE_OR_ARGUMENT");
  if (command === "inventory" && !options.length) {
    const manifest = read("package.json");
    console.log(JSON.stringify({ schemaVersion: 1, cwd: root, ...sourceIdentity(), node: process.version, engines: manifest.engines,
      packageManager: manifest.packageManager, dependencies: manifest.dependencies, devDependencies: manifest.devDependencies,
      routes: sourceFiles(root, "src/app").filter((path) => /\/(?:page|route)\.(?:ts|tsx)$/u.test(path)),
      modules: Object.fromEntries(["apps/mobile", "packages/contracts", "packages/api-client", "src/offline", "src/server/outbox", "src/server/notifications"].map((path) => [path, existsSync(join(root, path)) ? "PRESENT" : "MISSING"])) }, null, 2));
    return 0;
  }
  if (command === "external-check" && !options.length) { const status = externalStatus(process.env); console.log(JSON.stringify(status, null, 2)); return status.exitCode; }
  if (command === "verify" && options.every((option) => option.startsWith("--scope=")) && options.length <= 1) {
    const scope = options[0]?.slice(8) ?? "full";
    const id = new Date().toISOString().replaceAll(/[:.]/gu, "-");
    const directory = join(root, evidenceRoot, id);
    mkdirSync(directory, { recursive: true });
    const checks = scopeManifest(scope);
    const before = sourceIdentity();
    const result = await runChecks(checks, { cwd: root, onResult: (record) => {
      writeFileSync(join(directory, `${record.id}.log`), record.output);
      console.log(`${record.id}: ${record.status} exit=${record.exitCode}`);
    } });
    const after = sourceIdentity();
    if (before.sourceSha256 !== after.sourceSha256) { result.status = "incomplete"; result.exitCode = 1; }
    const receipt = { ...result, scope, manifestSha256: manifestHash(scope), cwd: root, startedAt: id, finishedAt: new Date().toISOString(), sourceBefore: before, sourceAfter: after,
      overallProductStatus: "INCOMPLETE", activationStatus: "NOT_ACTIVATED" };
    const path = join(directory, "receipt.json"); writeFileSync(path, JSON.stringify(receipt, null, 2));
    console.log(`receipt: ${relative(root, path).replaceAll("\\", "/")}; scoped=${result.status}; product=INCOMPLETE`);
    return result.exitCode;
  }
  if (command === "report" && options.length === 1 && options[0].startsWith("--receipt=")) {
    const path = resolve(root, options[0].slice(10));
    if (!path.startsWith(resolve(root, evidenceRoot) + "/") && !path.startsWith(resolve(root, evidenceRoot) + "\\")) throw new Error("INVALID_RECEIPT_PATH");
    if (!existsSync(path)) { console.log(JSON.stringify({ status: "missing", overallProductStatus: "INCOMPLETE" })); return 1; }
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    const summary = summarizeReceipt(receipt);
    const current = sourceIdentity();
    const matchingSource = receipt.sourceBefore?.sourceSha256 === current.sourceSha256 && receipt.sourceAfter?.sourceSha256 === current.sourceSha256;
    const logsMatch = Array.isArray(receipt.checks) && receipt.checks.every((check) => /^[a-z0-9-]+$/u.test(check.id) && existsSync(join(resolve(path, ".."), `${check.id}.log`)) && readFileSync(join(resolve(path, ".."), `${check.id}.log`), "utf8") === check.output);
    console.log(JSON.stringify({ ...summary, scope: receipt.scope, matchingSource, logsMatch, overallProductStatus: "INCOMPLETE", activationStatus: "NOT_ACTIVATED" }, null, 2));
    return matchingSource && logsMatch ? summary.exitCode : 1;
  }
  throw new Error("USAGE: inventory | external-check | verify [--scope=batch-1|full] | report --receipt=relative-run-path");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.code ?? error.message); process.exitCode = 1; });
}
