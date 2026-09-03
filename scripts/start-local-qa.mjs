import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import {
  buildLocalQaEnvironment,
  parseLocalQaPort,
} from "./local-qa-runtime.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();
const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const port = parseLocalQaPort(process.argv.slice(2));

for (const fileName of [
  ".env.local",
  ".env",
  "supabase/functions/e2e-runtime.defaults",
]) {
  const path = resolve(root, fileName);
  if (existsSync(path)) loadEnvFile(path);
}

await assertPortAvailable(port);
const environment = buildLocalQaEnvironment(port, process.env);
const origin = environment.NEXT_PUBLIC_APP_URL;
const nextCli = resolve(root, "node_modules", "next", "dist", "bin", "next");
if (!existsSync(nextCli)) throw new Error("LOCAL_QA_DEPENDENCIES_MISSING");

console.log("StallOrder local QA server");
console.log(`WORKTREE ${root}`);
console.log(`HEAD ${head}`);
console.log(`ORIGIN ${origin}`);
console.log("GUARDS development + loopback database + fixed test accounts");

const child = spawn(process.execPath, [nextCli, "dev", "--webpack", "-p", String(port)], {
  cwd: root,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});
const childExit = new Promise((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit({ code, signal }));
});

const startup = await Promise.race([
  waitForHealth(`${origin}/api/health`),
  childExit.then((result) => ({ exited: result })),
]);
if ("exited" in startup) {
  throw new Error(`LOCAL_QA_SERVER_EXITED_BEFORE_READY:${startup.exited.code ?? startup.exited.signal ?? "unknown"}`);
}
await warmLocalQaPage(`${origin}/login`);
await warmLocalQaPage(`${origin}/api/availability/config`);
await warmLocalQaLoginApi(`${origin}/api/auth/login`, origin);
console.log(`READY ${origin}/login`);

const result = await childExit;
process.exitCode = typeof result.code === "number" ? result.code : 1;

async function assertPortAvailable(targetPort) {
  await new Promise((resolveCheck, rejectCheck) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      rejectCheck(new Error(error.code === "EADDRINUSE" ? `LOCAL_QA_PORT_IN_USE:${targetPort}` : error.message));
    });
    server.listen({ port: targetPort, exclusive: true }, () => {
      server.close(resolveCheck);
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return { ready: true };
    } catch {
      // The dev server is still compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  child.kill();
  throw new Error("LOCAL_QA_SERVER_HEALTH_TIMEOUT");
}

async function warmLocalQaPage(url) {
  const response = await fetch(url, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`LOCAL_QA_PAGE_NOT_READY:${response.status}`);
  await response.arrayBuffer();
}

async function warmLocalQaLoginApi(url, origin) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: "{}",
  });
  if (response.status !== 400) throw new Error(`LOCAL_QA_LOGIN_API_NOT_READY:${response.status}`);
  await response.arrayBuffer();
}
