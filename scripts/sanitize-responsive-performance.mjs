import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";

const phase = process.argv[2];
if (!["before", "after"].includes(phase)) throw Error("Expected before|after");
const directory = "artifacts/ux-responsive-20260930/b3-performance";
const privateDirectory = path.resolve("..", "b3-performance-private-raw-20260930", `${phase}-${Date.now()}`);
const values = Object.entries(parseEnv(readFileSync(".env.local", "utf8")))
  .filter(([key, value]) => value.length > 8 && (/(KEY|SECRET|TOKEN|PASSWORD)/.test(key) || /^[a-z]+:\/\/[^/]*:[^/@]*@/.test(value)));
const hash = text => createHash("sha256").update(text).digest("hex");
const receipt = { phase, at: new Date().toISOString(), algorithmSha256: hash(readFileSync(new URL(import.meta.url))), privateDirectory, policy: "Known environment key/token/secret/password and credential-bearing URL values redacted; original evidence preserved outside the repository. Samples and diagnostic observations retained.", files: [] };
for (const name of readdirSync(directory).filter(name => name.startsWith(`${phase}-`) && /\.(json|log)$/.test(name))) {
  const file = path.join(directory, name), original = readFileSync(file, "utf8");
  let sanitized = original;
  const matchedKeys = [];
  for (const [key, value] of values) {
    if (sanitized.includes(value)) { sanitized = sanitized.replaceAll(value, `[REDACTED_${key}]`); matchedKeys.push(key); }
  }
  if (sanitized !== original) {
    mkdirSync(privateDirectory, { recursive: true });
    writeFileSync(path.join(privateDirectory, name), original, { flag: "wx" });
    writeFileSync(file, sanitized);
    receipt.files.push({ name, matchedKeys, originalSha256: hash(original), sanitizedSha256: hash(sanitized) });
  }
}
writeFileSync(path.join(directory, `${phase}-sanitization.json`), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ phase, sanitizedFileCount: receipt.files.length, privateDirectory }));
