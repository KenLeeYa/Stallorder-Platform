import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildLocalQaEnvironment } from "./local-qa-runtime.mjs";
const system = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|pathext)$/i.test(key)));
const target = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .}}", "supabase_db_stallorder-compliance-20260913"], { env: system, encoding: "utf8", windowsHide: true }));
if (target.Config.Labels["com.supabase.cli.project"] !== "stallorder-compliance-20260913" || target.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort !== "55992") throw new Error("QA_TARGET_MISMATCH");
const cli = resolve("node_modules/@supabase/cli-windows-x64/bin/supabase.exe");
const status = JSON.parse(execFileSync(cli, ["status", "--workdir", "C:/Users/KY/AppData/Local/Temp/stallorder-compliance-20260913", "-o", "json"], { env: system, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
const environment = buildLocalQaEnvironment(3093, { ...system,
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55992/postgres", DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:55992/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55991", NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "http://127.0.0.1:55991/functions/v1",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY,
  ABUSE_HASH_SECRET: "local-e2e-only-abuse-hash-secret-32-bytes", TOKEN_DERIVATION_SECRET: "local-e2e-only-token-derivation-secret-32-bytes",
  AUDIT_IP_HASH_SECRET: "compliance-local-only-audit-hash-key", SESSION_FINGERPRINT_HASH_SECRET: "compliance-local-only-session-hash-key",
  OFFLINE_PERMIT_SIGNING_SECRET: "compliance-local-only-offline-signing-key", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", TURNSTILE_ALLOW_TEST_KEYS: "true",
  COMPLIANCE_ENABLED: "true", COMPLIANCE_FIELD_KEY: Buffer.alloc(32, 29).toString("base64"), NEXT_TELEMETRY_DISABLED: "1",
});
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", "127.0.0.1", "-p", "3093"], { env: environment, stdio: "inherit", windowsHide: true });
writeFileSync("docs/security-compliance/qa-service.json", JSON.stringify({ project: "stallorder-compliance-20260913", worktree: process.cwd(), wrapperPid: process.pid, childPid: child.pid, port: 3093, databasePort: 55992, startedAt: new Date().toISOString(), secretsLogged: false }, null, 2));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
