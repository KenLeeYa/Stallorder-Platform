import { expect, test } from "vitest";
import { runChecks, summarizeReceipt } from "./runner.mjs";

test("required failure, missing and not_run never aggregate to passed", async () => {
  const result = await runChecks([
    { id: "fail", required: true, command: [process.execPath, "-e", "process.exit(7)"], timeoutMs: 2000 },
    { id: "missing", required: true, command: ["awesome-command-that-does-not-exist"], timeoutMs: 2000 },
    { id: "not-run", required: true, command: null, timeoutMs: 2000 },
  ]);
  expect(result.exitCode).toBe(1);
  expect(result.checks.map(({ status }) => status)).toEqual(["failed", "missing", "not_run"]);
  expect(result.checks[0].exitCode).toBe(7);
});

test("timeout is bounded, nonzero, and subsequent check still executes", async () => {
  const result = await runChecks([
    { id: "slow", required: true, command: [process.execPath, "-e", "setInterval(()=>{},1000)"], timeoutMs: 100 },
    { id: "after", required: true, command: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 2000 },
  ]);
  expect(result.exitCode).toBe(1);
  expect(result.checks.map(({ status }) => status)).toEqual(["timeout", "passed"]);
  expect(result.checks[0].exitCode).not.toBe(0);
});

test("report rejects an empty or contradictory green receipt", () => {
  expect(summarizeReceipt({ checks: [], exitCode: 0 })).toEqual({ status: "invalid", exitCode: 1 });
  expect(summarizeReceipt({ checks: [{ id: "required", required: true, status: "not_run", exitCode: null }], exitCode: 0 })).toEqual({ status: "invalid", exitCode: 1 });
});

test("split child output cannot expose an inherited secret", async () => {
  const secret = "synthetic-private-split-token";
  const result = await runChecks([{ id: "redaction", required: true, command: [process.execPath, "-e", 'process.stdout.write(process.env.TEST_TOKEN.slice(0,10)); setTimeout(()=>process.stdout.write(process.env.TEST_TOKEN.slice(10)),20)'], timeoutMs: 2000 }], { env: { ...process.env, TEST_TOKEN: secret } });
  expect(result.exitCode).toBe(0);
  expect(result.checks[0].output).toBe("[REDACTED]");
});
