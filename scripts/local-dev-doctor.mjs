import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const secretNamePatterns = [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "VERCEL_TOKEN",
  "CRON_API_SECRET",
];

function run(command, args, options = {}) {
  const shell = process.platform === "win32";
  const quotePart = (part) => {
    const text = String(part);
    return /\s/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
  };
  const commandLine = shell
    ? [command, ...args].map(quotePart).join(" ")
    : command;
  const result = spawnSync(commandLine, shell ? [] : args, {
    encoding: "utf8",
    shell,
    ...options,
  });

  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    status: result.status,
  };
}

function line(status, label, detail = "") {
  const suffix = detail ? ` - ${detail}` : "";
  console.log(`${status} ${label}${suffix}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function commandVersion(label, command, args = ["--version"]) {
  const result = run(command, args);
  line(result.ok ? "PASS" : "WARN", label, result.ok ? result.stdout.split(/\r?\n/)[0] : "not available");
}

function checkTooling() {
  commandVersion("Git", "git");
  commandVersion("Node.js", "node");
  commandVersion("npm", "npm");
  commandVersion("pnpm", "pnpm");
  commandVersion("Yarn", "yarn");
  commandVersion("Docker", "docker");
  commandVersion("Docker Compose", "docker", ["compose", "version"]);
  const dockerInfo = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  line(dockerInfo.ok ? "PASS" : "WARN", "Docker Engine", dockerInfo.ok ? dockerInfo.stdout : "not running");
  commandVersion("Vercel CLI", "npx", ["vercel", "--version"]);
  commandVersion("Supabase CLI", "npx", ["supabase", "--version"]);
  commandVersion("Codex CLI", "codex");
}

function checkPackageManager(pkg) {
  const lockfiles = [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
  ].filter(([path]) => existsSync(path));

  const summary = lockfiles.map(([path]) => path).join(", ") || "none";
  line(lockfiles.length === 1 ? "PASS" : "FAIL", "single lockfile", summary);
  line(pkg.packageManager?.startsWith("npm@") ? "PASS" : "FAIL", "packageManager", pkg.packageManager ?? "missing");
  line(pkg.engines?.node ? "PASS" : "FAIL", "engines.node", pkg.engines?.node ?? "missing");
}

function checkScripts(pkg) {
  const scripts = pkg.scripts ?? {};
  line(scripts.postinstall === "prisma generate" ? "PASS" : "FAIL", "postinstall", scripts.postinstall ?? "missing");
  const buildRunsPrisma = typeof scripts.build === "string"
    && scripts.build.includes("prisma generate")
    && scripts.build.includes("next build");
  line(buildRunsPrisma ? "PASS" : "FAIL", "build runs prisma generate before next build", scripts.build ?? "missing");
  line(
    typeof scripts.build === "string" && !scripts.build.includes("migrate dev") ? "PASS" : "FAIL",
    "build does not run prisma migrate dev",
  );
}

function checkPrisma() {
  const schemaPath = "prisma/schema.prisma";
  if (!existsSync(schemaPath)) {
    line("FAIL", "Prisma schema", "missing");
    return;
  }

  const schema = readFileSync(schemaPath, "utf8");
  line(schema.includes('provider  = "postgresql"') || schema.includes('provider = "postgresql"') ? "PASS" : "FAIL", "Prisma provider", "postgresql");
  line(schema.includes('url       = env("DATABASE_URL")') || schema.includes('url      = env("DATABASE_URL")') ? "PASS" : "FAIL", "Prisma DATABASE_URL");
  line(schema.includes('directUrl = env("DIRECT_URL")') ? "PASS" : "WARN", "Prisma DIRECT_URL");
}

function checkSecretHygiene() {
  const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  line(gitignore.includes(".env*") && gitignore.includes("!.env.example") ? "PASS" : "FAIL", ".env files ignored except .env.example");
  line(gitignore.includes(".vercel") ? "PASS" : "FAIL", ".vercel ignored");

  const trackedEnv = run("git", ["ls-files", ".env", ".env.local", ".env.production", ".env.production.local", ".vercel/project.json"]);
  line(trackedEnv.ok && trackedEnv.stdout === "" ? "PASS" : "FAIL", "no tracked local env or Vercel project file");

  const example = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
  for (const name of secretNamePatterns) {
    if (example.includes(`${name}=`)) {
      line("PASS", `.env.example declares ${name}`, "placeholder only");
    }
  }
}

function checkVercelEnvNames() {
  const required = ["DATABASE_URL", "DIRECT_URL"];
  for (const environment of ["production", "preview"]) {
    const result = run("npx", [
      "vercel",
      "env",
      "ls",
      environment,
      "--project",
      "stallorder-platform",
      "--scope",
      "team_MMfsiG94K9Zy3e6w7Ccc9xY4",
      "--non-interactive",
    ]);

    if (!result.ok) {
      line("WARN", `Vercel ${environment} env names`, "CLI unavailable or not authenticated");
      continue;
    }

    for (const key of required) {
      line(result.stdout.includes(key) ? "PASS" : "FAIL", `Vercel ${environment} has ${key}`);
    }
  }
}

const pkg = readJson("package.json");

console.log("StallOrder local development doctor");
console.log("This script prints secret names only; it never prints secret values.");
checkTooling();
checkPackageManager(pkg);
checkScripts(pkg);
checkPrisma();
checkSecretHygiene();
checkVercelEnvNames();
