import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLocalQaEnvironment } from "./local-qa-runtime.mjs";

const require = createRequire(import.meta.url);
const nextEnvPath = require.resolve("@next/env");
const directories = [];
const database = "postgresql://postgres:postgres@127.0.0.1:55992/postgres";

function fixture(file, content) {
  const directory = mkdtempSync(join(tmpdir(), "stallorder-env-file-test-"));
  directories.push(directory);
  writeFileSync(join(directory, file), content);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});

describe("local QA environment files", () => {
  it("reproduces Next loading a provider credential absent from its parent environment", () => {
    const directory = fixture(".env.development.local", "LINE_PLATFORM_CHANNEL_ACCESS_TOKEN=fixture-only-token\n");
    const output = execFileSync(process.execPath, ["-e", `
      require(${JSON.stringify(nextEnvPath)}).loadEnvConfig(${JSON.stringify(directory)}, true, {info(){},error(){}});
      process.stdout.write(JSON.stringify({reloaded: process.env.LINE_PLATFORM_CHANNEL_ACCESS_TOKEN === "fixture-only-token"}));
    `], { env: { NODE_ENV: "development" }, encoding: "utf8", windowsHide: true });
    expect(JSON.parse(output)).toEqual({ reloaded: true });
  });

  it.each([".env.development.local", ".env.local", ".env.development", ".env"])(
    "blocks provider credentials in %s before a QA child can load them",
    (file) => {
      const directory = fixture(file, "LINE_PLATFORM_CHANNEL_ACCESS_TOKEN=fixture-only-token\n");
      expect(() => buildLocalQaEnvironment(3093, { DATABASE_URL: database }, { envDirectory: directory }))
        .toThrow(`LOCAL_QA_ENV_FILE_UNAPPROVED:${file}:LINE_PLATFORM_CHANNEL_ACCESS_TOKEN`);
    },
  );

  it("blocks a remote destination in a lower-priority file even if the parent overrides it", () => {
    const directory = fixture(".env.development", "DIRECT_URL=postgresql://user:never-print-this@db.example/postgres\n");
    expect(() => buildLocalQaEnvironment(3093, {
      DATABASE_URL: database, DIRECT_URL: database,
    }, { envDirectory: directory })).toThrow("LOCAL_QA_EXTERNAL_DESTINATION:DIRECT_URL");
  });

  it.each([
    ["LINE_PLATFORM_ENABLED", "true"],
    ["LINE_PLATFORM_BINDING_JSON", '{"endpointUrl":"https://app.qidaigo.com/mini"}'],
    ["PAYMENT_LINE_PAY_CHANNEL_SECRET", "fixture-only-pay-secret"],
    ["NODE_OPTIONS", "--require ./untrusted.cjs"],
  ])("rejects reintroduced platform configuration or credentials: %s", (key, value) => {
    const directory = fixture(".env.local", `${key}=${value}\n`);
    expect(() => buildLocalQaEnvironment(3093, { DATABASE_URL: database }, { envDirectory: directory }))
      .toThrow(`LOCAL_QA_ENV_FILE_UNAPPROVED:.env.local:${key}`);
  });

  it("keeps the verified local runtime through the actual Next environment loader", () => {
    const directory = fixture(".env", `DATABASE_URL=${database}\nPAYMENT_PROVIDER_MODE=live\n`);
    const environment = buildLocalQaEnvironment(3093, { DATABASE_URL: database }, { envDirectory: directory });
    const output = execFileSync(process.execPath, ["-e", `
      require(${JSON.stringify(nextEnvPath)}).loadEnvConfig(${JSON.stringify(directory)}, true, {info(){},error(){}});
      process.stdout.write(JSON.stringify({mode: process.env.PAYMENT_PROVIDER_MODE, origin: process.env.APP_BASE_URL,
        databaseLocal: process.env.DATABASE_URL === ${JSON.stringify(database)},
        hasLineToken: Boolean(process.env.LINE_PLATFORM_CHANNEL_ACCESS_TOKEN)}));
    `], { env: environment, encoding: "utf8", windowsHide: true });
    expect(JSON.parse(output)).toEqual({ mode: "mock", origin: "http://127.0.0.1:3093", databaseLocal: true, hasLineToken: false });
  });
});
