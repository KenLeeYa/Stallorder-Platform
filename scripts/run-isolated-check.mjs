import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Explicit child allowlist. Never forward the desktop's provider/Production credentials.
const systemKeys = /^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|programfiles(?:\(x86\))?|comspec|pathext|number_of_processors)$/i;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.test(key)));
Object.assign(environment, {
  NODE_ENV: "test", APP_ENV: "test", NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55992/compliance_test",
  DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:55992/compliance_test",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3093", APP_BASE_URL: "http://127.0.0.1:3093",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55991",
  NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "http://127.0.0.1:55991/functions/v1",
  PAYMENT_PROVIDER_MODE: "mock", OAUTH_PROVIDER_MODE: "mock", REPORT_DELIVERY_MODE: "simulate",
  EXTERNAL_DISPATCH_ENABLED: "false", COMPLIANCE_ENABLED: "false",
});
const commands = {
  test: "vitest/vitest.mjs", typecheck: "typescript/bin/tsc", lint: "eslint/bin/eslint.js",
  prisma: "prisma/build/index.js", build: "next/dist/bin/next",
  database: "vitest/vitest.mjs",
  browser: "@playwright/test/cli.js",
};
const [command, ...args] = process.argv.slice(2);
if (!commands[command]) throw new Error("ISOLATED_CHECK_COMMAND_INVALID");
if (command === "build") environment.NODE_ENV = "production";
if (command === "database" || command === "browser") {
  const target = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .}}", "supabase_db_stallorder-compliance-20260913"], { env: environment, encoding: "utf8", windowsHide: true }));
  if (target.Config.Labels["com.supabase.cli.project"] !== "stallorder-compliance-20260913"
    || target.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort !== "55992") throw new Error("DATABASE_TEST_TARGET_MISMATCH");
  Object.assign(environment, { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55992/postgres", DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:55992/postgres",
    COMPLIANCE_DB_TESTS: "true", COMPLIANCE_ENABLED: "true", COMPLIANCE_FIELD_KEY: Buffer.alloc(32, 29).toString("base64"), COMPLIANCE_DELETION_DRY_RUN: "true" });
  if (command === "browser") environment.PLAYWRIGHT_APP_URL = "http://127.0.0.1:3093";
}
const child = spawn(process.execPath, [resolve("node_modules", commands[command]), ...args], {
  env: environment, cwd: process.cwd(), stdio: "inherit", windowsHide: true,
});
child.once("error", () => { process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
