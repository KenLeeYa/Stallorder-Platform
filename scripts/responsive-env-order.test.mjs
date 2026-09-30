import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("responsive config loads its runtime identity before baseline defaults", () => {
  const directory = mkdtempSync(join(tmpdir(), "responsive-env-order-"));
  const environment = {
    RESPONSIVE_QA_RUN: "true", PLAYWRIGHT_APP_URL: "http://127.0.0.1:3026",
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:56822/postgres",
    PRIMARY_SUPABASE_URL: "http://127.0.0.1:56821", PLAYWRIGHT_PRODUCTION_SERVER: "true",
    ABUSE_HASH_SECRET: "responsive-fixture-abuse", TOKEN_DERIVATION_SECRET: "responsive-fixture-token",
  };
  try {
    mkdirSync(join(directory, "supabase/functions"), { recursive: true });
    writeFileSync(join(directory, ".env.local"), Object.entries(environment).map(([key, value]) => `${key}=${value}`).join("\n"));
    writeFileSync(join(directory, "supabase/functions/e2e-runtime.defaults"), "ABUSE_HASH_SECRET=baseline-fixture-abuse\nTOKEN_DERIVATION_SECRET=baseline-fixture-token\n");
    const env = { ...process.env };
    for (const key of [...Object.keys(environment), "APP_BASE_URL"]) delete env[key];
    const config = new URL("../playwright.responsive.config.ts", import.meta.url).href;
    const source = `import(${JSON.stringify(config)}).then(()=>console.log(JSON.stringify({abuse:process.env.ABUSE_HASH_SECRET==='responsive-fixture-abuse',token:process.env.TOKEN_DERIVATION_SECRET==='responsive-fixture-token'})))`;
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href, "-e", source], { cwd: directory, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ abuse: true, token: true });
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + "\\responsive-env-order-") && !resolve(directory).startsWith(resolve(tmpdir()) + "/responsive-env-order-")) throw new Error("UNEXPECTED_FIXTURE_DIRECTORY");
    rmSync(directory, { recursive: true });
  }
});
