import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseLocalQaPort } from "./local-qa-runtime.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();
const port = parseLocalQaPort(process.argv.slice(2));
const origin = `http://127.0.0.1:${port}`;
const healthResponse = await fetch(`${origin}/api/health`, {
  cache: "no-store",
  redirect: "error",
}).catch(() => null);

if (!healthResponse?.ok) {
  throw new Error(`LOCAL_QA_SERVER_NOT_READY:${origin}`);
}

console.log(`QA ORIGIN ${origin}`);
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "e2e/local-qa-readiness.spec.ts"],
  {
    cwd: root,
    env: {
      ...process.env,
      LOCAL_QA_READINESS: "true",
      PLAYWRIGHT_REUSE_EXISTING_SERVER: "true",
      PLAYWRIGHT_APP_URL: origin,
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
