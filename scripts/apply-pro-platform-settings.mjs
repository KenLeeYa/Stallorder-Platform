import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const apply = process.argv.includes("--apply");
const checkOnly = process.argv.includes("--check");
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const supabaseRefs = [
  ["staging", process.env.SUPABASE_STAGING_PROJECT_REF?.trim()],
  ["production", process.env.SUPABASE_PRODUCTION_PROJECT_REF?.trim()],
].filter(([, ref]) => ref);
const vercelProject = process.env.VERCEL_PROJECT_NAME?.trim() || "stallorder-platform";
const vercelShim = process.platform === "win32"
  ? join(process.env.APPDATA || "", "npm", "vercel.ps1")
  : "vercel";
const skewMaxAgeSeconds = process.env.VERCEL_SKEW_MAX_AGE_SECONDS?.trim() || "604800";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function mask(value) {
  if (!value) return "(missing)";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function run(label, command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) fail(`${label}: ${result.error?.message || output || "command failed"}`);
  return output;
}

function runVercel(label, args) {
  if (process.platform !== "win32") {
    return run(label, vercelShim, args);
  }
  if (!existsSync(vercelShim)) {
    fail(`Vercel CLI shim not found at ${vercelShim}`);
  }
  return run(label, "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", vercelShim, ...args]);
}

function parseCliJson(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function supabaseRequest(projectRef, method, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method,
    headers: {
      authorization: `Bearer ${supabaseToken}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const message = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function configureSupabaseAuth() {
  if (supabaseRefs.length === 0) {
    console.log("WARN: Missing SUPABASE_STAGING_PROJECT_REF and SUPABASE_PRODUCTION_PROJECT_REF; skipped Supabase Auth Pro settings.");
    return;
  }
  if (!supabaseToken) {
    console.log("WARN: Missing SUPABASE_ACCESS_TOKEN; skipped Supabase Auth Pro settings.");
    return;
  }

  for (const [environment, projectRef] of supabaseRefs) {
    const current = await supabaseRequest(projectRef, "GET");
    const enabled = current?.password_hibp_enabled === true;
    console.log(`Supabase ${environment} (${mask(projectRef)}) leaked password protection: ${enabled ? "enabled" : "disabled"}`);
    if (enabled || checkOnly || !apply) continue;
    await supabaseRequest(projectRef, "PATCH", { password_hibp_enabled: true });
    const updated = await supabaseRequest(projectRef, "GET");
    if (updated?.password_hibp_enabled !== true) {
      fail(`Supabase ${environment} leaked password protection did not enable.`);
    }
    console.log(`PASS: Supabase ${environment} leaked password protection enabled.`);
  }
}

function configureVercel() {
  if (checkOnly) {
    const protection = parseCliJson(runVercel("Vercel protection status", ["project", "protection", vercelProject, "--format", "json"]));
    if (protection) {
      console.log(`Vercel SSO protection: ${protection.ssoProtection?.deploymentType || "not_configured"}`);
      console.log(`Vercel Git fork protection: ${protection.gitForkProtection === true ? "enabled" : "disabled"}`);
      console.log(`Vercel Skew Protection max age: ${protection.skewProtectionMaxAge ?? "not_configured"}`);
      console.log(`Vercel automation bypass entries: ${Object.keys(protection.protectionBypass || {}).length}`);
    }
    return;
  }
  if (!apply) {
    console.log(`DRY-RUN: would enable Vercel Speed Insights, Web Analytics and Skew Protection on ${vercelProject}.`);
    return;
  }
  runVercel("Vercel Speed Insights", ["project", "speed-insights", vercelProject, "--format", "json"]);
  runVercel("Vercel Web Analytics", ["project", "web-analytics", vercelProject, "--format", "json"]);
  runVercel("Vercel Skew Protection", [
    "project",
    "protection",
    "enable",
    vercelProject,
    "--skew",
    "--skew-max-age",
    skewMaxAgeSeconds,
    "--format",
    "json",
  ]);
  console.log(`PASS: Vercel Pro observability and skew protection are enabled for ${vercelProject}.`);
}

console.log(apply ? "Mode: APPLY" : checkOnly ? "Mode: CHECK" : "Mode: DRY-RUN");
await configureSupabaseAuth();
configureVercel();
