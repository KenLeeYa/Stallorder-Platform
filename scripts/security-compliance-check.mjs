import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { readCheckedFile } from "./lib/checked-file-read.mjs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const output = resolve(root, "docs/security-compliance"); mkdirSync(output, { recursive: true });
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
const candidates = [];
const rules = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["GITHUB_TOKEN", /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/g],
  ["AWS_ACCESS_KEY", /\bAKIA[0-9A-Z]{16}\b/g],
  ["LIVE_PAYMENT_KEY", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g],
  ["OPENAI_PROJECT_KEY", /\bsk-proj-[A-Za-z0-9_-]{40,}/g],
];
let scanned = 0;
const scan = (file) => {
  const path = resolve(root, file);
  let bytes;
  try { bytes = readCheckedFile(path, { maxBytes: 20_000_000 }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!bytes) return;
  const content = bytes.toString("utf8"); scanned++;
  for (const [kind, pattern] of rules) for (const match of content.matchAll(pattern)) {
    candidates.push({ file, line: content.slice(0, match.index).split("\n").length, kind, fingerprint: sha256(match[0]).slice(0, 16) });
  }
};
for (const file of files) if (!file.startsWith("docs/security-compliance/") && !/^\.env(?:\.|$)/.test(file)
  && /\.(?:ts|tsx|js|mjs|cjs|sql|json|yml|yaml|md|toml|ps1)$/.test(file)) scan(file);
let bundleScanned = false;
if (process.argv.includes("--bundle") && existsSync(resolve(root, ".next"))) {
  const walk = (dir) => { for (const item of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory() && !["cache", "diagnostics"].includes(item.name)) walk(file);
    else if (item.isFile() && /\.(js|json|map)$/.test(item.name)) scan(file);
  } };
  walk(".next"); bundleScanned = true;
}
const lockBytes = readFileSync("package-lock.json"); const lock = JSON.parse(lockBytes);
const dependencies = Object.entries(lock.packages).filter(([name]) => name).map(([path, item]) => ({ path, version: item.version, license: item.license ?? "UNKNOWN", dev: Boolean(item.dev), integrity: item.integrity ?? null }));
const noticeReview = dependencies.filter((item) => item.license === "UNKNOWN" || /GPL|AGPL|SSPL|BUSL|SEE LICENSE/i.test(item.license));
writeFileSync(resolve(output, "dependency-license-inventory.json"), JSON.stringify({ observedAt: new Date().toISOString(), lockSha256: sha256(lockBytes), dependencies, reviewRequired: noticeReview, legalApproval: "NOT_OBTAINED" }, null, 2) + "\n");
const result = { observedAt: new Date().toISOString(), tool: "repository-known-credential-pattern-scan-v1", scanned, bundleScanned, candidates,
  status: candidates.length ? "REVIEW_REQUIRED" : "PASS_KNOWN_PATTERNS_ONLY", limits: "Not a proof of no secrets or PII. Provider logs, arbitrary tokens, runtime values and historical Git objects need independent review." };
writeFileSync(resolve(output, "source-scan.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ scanned, bundleScanned, credentialCandidates: candidates.length, dependencies: dependencies.length, licensesNeedingReview: noticeReview.length }));
process.exitCode = candidates.length ? 1 : 0;
