import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];
const productionUrl = "https://app.qidaigo.com";
const stagingUrl = "https://staging.qidaigo.com";
const productionSupabaseUrl = "https://eyuctbnlvnbnivwasvqr.supabase.co";
const stagingSupabaseUrl = "https://daeqwtpaxcebmtwxqdkj.supabase.co";

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function repositoryFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

for (const url of [productionUrl, stagingUrl, productionSupabaseUrl, stagingSupabaseUrl]) {
  requireCondition(new URL(url).protocol === "https:", `HTTPS is required: ${url}`);
}
requireCondition(productionSupabaseUrl !== stagingSupabaseUrl, "Production and Staging Supabase URLs must differ.");

for (const requiredFile of [
  "src/app/auth/google/route.ts",
  "src/app/auth/callback/route.ts",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
]) {
  requireCondition(existsSync(path.join(root, requiredFile)), `Required OAuth file is missing: ${requiredFile}`);
}

const envExample = read(".env.example");
for (const key of [
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET",
  "NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED",
]) {
  requireCondition(new RegExp(`^${key}=`, "m").test(envExample), `.env.example is missing ${key}.`);
}
requireCondition(
  !/^NEXT_PUBLIC_[A-Z0-9_]*GOOGLE[A-Z0-9_]*SECRET=/m.test(envExample),
  "A Google secret must never use a NEXT_PUBLIC_ variable.",
);

const supabaseConfig = read("supabase/config.toml");
for (const expected of [
  '[auth.external.google]',
  'client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"',
  'secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"',
  'skip_nonce_check = false',
  '"http://localhost:3000/auth/callback"',
  '"http://127.0.0.1:3000/auth/callback"',
]) {
  requireCondition(supabaseConfig.includes(expected), `supabase/config.toml is missing: ${expected}`);
}

const googleRoute = read("src/app/auth/google/route.ts");
requireCondition(googleRoute.includes('provider: "google"'), "Google OAuth provider is not configured in the start route.");
requireCondition(googleRoute.includes('scopes: "openid email profile"'), "Google OAuth scopes must be openid email profile only.");
requireCondition(googleRoute.includes("isGoogleLoginEnabled"), "Google OAuth must use the explicit feature flag.");

const callbackRoute = read("src/app/auth/callback/route.ts");
requireCondition(callbackRoute.includes("exchangeCodeForSession"), "OAuth callback must exchange the PKCE code.");
requireCondition(callbackRoute.includes("resolveOAuthDestination"), "OAuth callback must enforce role-aware redirects.");
requireCondition(callbackRoute.includes("email_confirmed_at"), "OAuth callback must require a verified email.");
requireCondition(!callbackRoute.includes("user_metadata.role"), "OAuth callback must not trust user_metadata.role.");

const files = repositoryFiles();
const allowedEnvFiles = new Set([".env.example", "supabase/functions/.env.example"]);
const committedEnvFiles = files.filter((file) => {
  const name = path.posix.basename(file);
  return name.startsWith(".env") && !allowedEnvFiles.has(file);
});
requireCondition(committedEnvFiles.length === 0, `Environment files must not be committed: ${committedEnvFiles.join(", ")}`);

const credentialFiles = files.filter((file) => /(?:^|\/)client_secret[^/]*\.json$/i.test(file));
requireCondition(credentialFiles.length === 0, `Google credential files must not be committed: ${credentialFiles.join(", ")}`);

const literalSecretPatterns = [
  { name: "Google OAuth client secret", pattern: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { name: "Google OAuth access token", pattern: /ya29\.[A-Za-z0-9_-]{20,}/g },
  { name: "Google OAuth refresh token", pattern: /1\/\/[A-Za-z0-9_-]{20,}/g },
  { name: "Supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{20,}/g },
];
for (const file of files) {
  const absolutePath = path.join(root, file);
  if (!existsSync(absolutePath) || statSync(absolutePath).size > 1_000_000) continue;
  let content;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    continue;
  }
  requireCondition(
    !/^\s*(?:export\s+)?NEXT_PUBLIC_GOOGLE_CLIENT_SECRET\s*=/m.test(content),
    `NEXT_PUBLIC_GOOGLE_CLIENT_SECRET is forbidden in ${file}`,
  );
  requireCondition(
    !/^\s*(?:export\s+)?GOOGLE_CLIENT_SECRET\s*=\s*["']?(?!$|replace|placeholder|<)/mi.test(content),
    `A Google client secret assignment is forbidden in ${file}`,
  );
  for (const rule of literalSecretPatterns) {
    if (rule.pattern.test(content)) failures.push(`${rule.name} literal detected in ${file}`);
    rule.pattern.lastIndex = 0;
  }
}

for (const runtimeFile of ["supabase/config.toml", "vercel.json", ".github/workflows/ci.yml"]) {
  if (!existsSync(path.join(root, runtimeFile))) continue;
  requireCondition(
    !/https:\/\/\*\.[A-Za-z0-9.-]*qidaigo\.com/i.test(read(runtimeFile)),
    `Wildcard Production OAuth redirect detected in ${runtimeFile}`,
  );
}

const productionClientId = process.env.GOOGLE_OAUTH_PRODUCTION_CLIENT_ID;
const stagingClientId = process.env.GOOGLE_OAUTH_STAGING_CLIENT_ID;
if (productionClientId && stagingClientId) {
  requireCondition(productionClientId !== stagingClientId, "Production and Staging Google Client IDs must differ.");
} else {
  warnings.push("Client ID separation was not checked because CI-safe Client ID variables were not provided.");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`PASS: Google OAuth configuration and ${files.length} repository files passed validation.`);
