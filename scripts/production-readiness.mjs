import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function trackedFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

const files = trackedFiles();
const allowedEnvFiles = new Set([".env.example", "supabase/functions/.env.example"]);
const committedEnvFiles = files.filter((file) => {
  const name = path.posix.basename(file);
  return name.startsWith(".env") && !allowedEnvFiles.has(file);
});
requireCondition(
  committedEnvFiles.length === 0,
  `Tracked environment files are forbidden: ${committedEnvFiles.join(", ")}`,
);

const sensitiveFileExtensions = new Set([".key", ".p12", ".pfx", ".pem"]);
const committedKeyFiles = files.filter((file) => sensitiveFileExtensions.has(path.extname(file)));
requireCondition(
  committedKeyFiles.length === 0,
  `Tracked credential files are forbidden: ${committedKeyFiles.join(", ")}`,
);

const textFiles = files.filter((file) => {
  try {
    return statSync(path.join(root, file)).size <= 1_000_000;
  } catch {
    return false;
  }
});
const literalSecretPatterns = [
  { name: "Supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", pattern: /gh(?:p|o|s|u|r)_[A-Za-z0-9]{30,}/g },
  { name: "Google OAuth client secret", pattern: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI API key", pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "service-role JWT", pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
];

for (const file of textFiles) {
  let content;
  try {
    content = read(file);
  } catch {
    continue;
  }
  for (const rule of literalSecretPatterns) {
    if (rule.pattern.test(content)) failures.push(`${rule.name} literal detected in ${file}`);
    rule.pattern.lastIndex = 0;
  }

  for (const match of content.matchAll(/postgres(?:ql)?:\/\/([^:\s/]+):([^@\s/]+)@([^/\s"']+)/g)) {
    const [, user, password, host] = match;
    const isLocal = /^(?:127\.0\.0\.1|localhost|host\.docker\.internal)(?::\d+)?$/i.test(host);
    const isPlaceholder = /replace|example|placeholder|<|>/i.test(`${user}${password}${host}`);
    if (!isLocal && !isPlaceholder) failures.push(`Direct database credential detected in ${file}`);
  }
}

for (const envFile of allowedEnvFiles) {
  const content = read(envFile);
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*["']?([^"']*)/);
    if (!match) continue;
    const [, key, value] = match;
    if (!/(?:SECRET|PASSWORD|TOKEN|DATABASE_URL|DIRECT_URL|SERVICE_ROLE|PRIVATE_KEY)/.test(key)) continue;
    const isSafeTemplate = !value
      || /replace|set-with|example|placeholder|<|>|127\.0\.0\.1|localhost/i.test(value);
    requireCondition(isSafeTemplate, `Real-looking value for ${key} detected in ${envFile}`);
  }
}

requireCondition(
  !files.some((file) => file.startsWith("public/") && /service.?role|secret.?key/i.test(file)),
  "A server credential appears to be stored below public/.",
);

const runtimeConfigurationFiles = files.filter((file) =>
  file === "vercel.json"
  || file.startsWith(".github/workflows/")
  || file === "scripts/production-smoke-test.mjs"
  || file.startsWith("src/"),
);
for (const file of runtimeConfigurationFiles) {
  const content = read(file);
  requireCondition(
    !/TURNSTILE_ALLOW_TEST_KEYS\s*[:=]\s*["']?true/i.test(content),
    `Turnstile test keys are enabled in runtime configuration: ${file}`,
  );
  requireCondition(
    !/demo-aming-chicken-qr-2026-rotate-me/i.test(content),
    `Demo QR token is present in runtime configuration: ${file}`,
  );
  requireCondition(
    !/NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|DATABASE_URL|DIRECT_URL|SERVICE_ROLE)/.test(content),
    `Server-only value uses NEXT_PUBLIC_ in ${file}`,
  );
}

const packageJson = JSON.parse(read("package.json"));
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (!/(?:prod|production|deploy|release)/i.test(name)) continue;
  requireCondition(
    !/(?:db:seed|prisma\s+db\s+seed|supabase\s+db\s+reset|--include-seed)/i.test(command),
    `Production script ${name} invokes demo seed or database reset.`,
  );
}
requireCondition(
  read("prisma/seed.ts").includes('ALLOW_DEMO_SEED !== "true"'),
  "prisma/seed.ts must retain its ALLOW_DEMO_SEED guard.",
);
requireCondition(
  /ALLOW_DEMO_SEED=["']?false/.test(read(".env.example")),
  ".env.example must disable demo seed by default.",
);

const migrationFiles = files
  .filter((file) => file.startsWith("supabase/migrations/") && file.endsWith(".sql"))
  .sort();
requireCondition(migrationFiles.length > 0, "No Supabase migrations were found.");
const migrationVersions = new Set();
for (const file of migrationFiles) {
  const name = path.posix.basename(file);
  const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
  requireCondition(Boolean(match), `Invalid migration filename: ${file}`);
  if (match) {
    requireCondition(!migrationVersions.has(match[1]), `Duplicate migration version: ${match[1]}`);
    migrationVersions.add(match[1]);
  }

  const content = read(file);
  const hasBlockingDestructiveSql = /\bdrop\s+table\b|\btruncate(?:\s+table)?\b|\balter\s+table[\s\S]{0,160}\balter\s+column[\s\S]{0,80}\btype\b/i.test(content);
  requireCondition(!hasBlockingDestructiveSql, `Unreviewed destructive SQL detected in ${file}`);
  if (/alter\s+table\s+public\.products\s+drop\s+column\s+category\s*;/i.test(content)) {
    const copiesDataFirst = /insert\s+into\s+public\.product_categories/i.test(content)
      && /update\s+public\.products/i.test(content);
    requireCondition(copiesDataFirst, `${file} drops products.category before preserving its data.`);
    warnings.push(`${file} contains a reviewed data-copy-then-drop migration for products.category.`);
  } else {
    requireCondition(!/\bdrop\s+column\b/i.test(content), `Unreviewed DROP COLUMN detected in ${file}`);
  }
}

for (const requiredTest of [
  "supabase/tests/database/multi_stall_rls.test.sql",
  "supabase/tests/database/qr_order_abuse.test.sql",
  "supabase/tests/database/security_hardening.test.sql",
]) {
  requireCondition(files.includes(requiredTest), `Required RLS/security test is missing: ${requiredTest}`);
}

const supabaseConfig = read("supabase/config.toml");
for (const functionName of ["create-order-session", "create-public-order", "get-public-order"]) {
  const section = new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt\\s*=\\s*false`);
  requireCondition(section.test(supabaseConfig), `${functionName} must remain an explicit public function.`);
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`PASS: ${files.length} tracked files and ${migrationFiles.length} migrations passed production guardrails.`);
