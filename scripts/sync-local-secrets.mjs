import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const configPath = resolve(process.env.SECRET_SYNC_FILE ?? ".secrets/stallorder.local.json");
const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function loadConfig() {
  if (!existsSync(configPath)) {
    fail(`missing local secret bundle: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    fail("local secret bundle is not valid JSON");
  }
}

function saveConfig(config) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function usesExamplePreviewUrl(value) {
  return value.split(",").some((candidate) => {
    try {
      const hostname = new URL(candidate.trim()).hostname.toLowerCase().replace(/\.$/, "");
      return hostname === "preview.example.com";
    } catch {
      return false;
    }
  });
}

function collectSecretValues(config) {
  const values = new Map();
  let changed = false;
  for (const item of config.secrets ?? []) {
    if (!item?.name || typeof item.name !== "string") fail("each secret requires a string name");
    if (typeof item.value === "string" && item.value.length > 0) {
      if (usesExamplePreviewUrl(item.value)) {
        fail(`${item.name} still uses the example Preview URL`);
      }
      values.set(item.name, item.value);
      continue;
    }
    if (item.generate === true) {
      const bytes = Number.isInteger(item.bytes) ? item.bytes : 32;
      if (bytes < 32) fail(`${item.name} must use at least 32 random bytes`);
      item.value = randomBytes(bytes).toString("base64url");
      values.set(item.name, item.value);
      changed = true;
      continue;
    }
    if (typeof item.valueFrom === "string") {
      continue;
    }
    fail(`${item.name} requires value, valueFrom, or generate=true`);
  }
  for (const item of config.secrets ?? []) {
    if (item.valueFrom) {
      const source = values.get(item.valueFrom);
      if (!source) fail(`${item.name} references missing valueFrom ${item.valueFrom}`);
      item.value = source;
      values.set(item.name, source);
      changed = true;
    }
  }
  if (changed) saveConfig(config);
  return values;
}

function redact(text, values) {
  let output = text;
  for (const value of values.values()) {
    if (value) output = output.split(value).join("[REDACTED]");
  }
  return output;
}

function runSecretCommand(label, args, input, values, env = process.env) {
  if (!apply) {
    console.log(`DRY-RUN: ${label}`);
    return;
  }
  const result = spawnSync(npxBin, args, {
    input,
    encoding: "utf8",
    env,
    shell: false,
  });
  if (result.status !== 0) {
    const stderr = redact(result.stderr || result.stdout || "command failed", values);
    fail(`${label}: ${stderr.trim()}`);
  }
  console.log(`PASS: ${label}`);
}

function syncVercel(config, values) {
  const vercel = config.vercel;
  if (!vercel) return;
  const team = vercel.team ? ["--scope", vercel.team] : [];
  for (const item of vercel.items ?? []) {
    const value = values.get(item.secret);
    if (!value) fail(`Vercel item ${item.name} references missing secret ${item.secret}`);
    for (const environment of item.environments ?? []) {
      if (item.replace === true) {
        runSecretCommand(
          `Vercel remove ${item.name} (${environment})`,
          ["vercel", "env", "rm", item.name, environment, "--yes", ...team],
          undefined,
          values,
        );
      }
      runSecretCommand(
        `Vercel add ${item.name} (${environment})`,
        ["vercel", "env", "add", item.name, environment, ...team],
        `${value}\n`,
        values,
      );
    }
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function syncSupabaseVault(config, values) {
  const vault = config.supabaseVault;
  if (!vault) return;
  const databaseUrlEnv = vault.databaseUrlEnv ?? "DIRECT_URL";
  const databaseUrl = process.env[databaseUrlEnv];
  if (!databaseUrl) fail(`missing ${databaseUrlEnv} for Supabase Vault sync`);
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  for (const item of vault.items ?? []) {
    const value = values.get(item.secret);
    if (!value) fail(`Vault item ${item.name} references missing secret ${item.secret}`);
    const description = item.description ?? `StallOrder ${item.name}`;
    const sql = [
      "begin;",
      `delete from vault.secrets where name = ${sqlLiteral(item.name)};`,
      `select vault.create_secret(${sqlLiteral(value)}, ${sqlLiteral(item.name)}, ${sqlLiteral(description)});`,
      "commit;",
      "",
    ].join("\n");
    runSecretCommand(
      `Supabase Vault upsert ${item.name}`,
      ["prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--stdin"],
      sql,
      values,
      env,
    );
  }
}

const config = loadConfig();
const values = collectSecretValues(config);

console.log(apply ? "Mode: APPLY" : "Mode: DRY-RUN");
console.log(`Local bundle: ${configPath}`);
console.log(`Loaded secret names: ${[...values.keys()].join(", ") || "(none)"}`);

syncVercel(config, values);
syncSupabaseVault(config, values);

console.log(apply
  ? "Done: secrets synced without printing values."
  : "Done: dry-run only. Remote apply still requires an explicit, Preview-only approval.");
