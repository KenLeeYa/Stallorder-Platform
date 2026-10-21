import { spawn } from "node:child_process";
import { scopeManifest, manifestHash } from "./scope-manifest.mjs";

export function summarizeReceipt(receipt) {
  const invalid = { status: "invalid", exitCode: 1 };
  if (receipt?.schemaVersion !== 1 || !["batch-1", "full"].includes(receipt.scope)
    || ![receipt.sourceBefore, receipt.sourceAfter].every((source) => /^[a-f0-9]{64}$/u.test(source?.sourceSha256 ?? ""))) return invalid;
  const expected = scopeManifest(receipt.scope);
  if (receipt.manifestSha256 !== manifestHash(receipt.scope) || !Array.isArray(receipt.checks) || receipt.checks.length !== expected.length
    || receipt.checks.some((check, index) => !check || check.id !== expected[index].id || check.required !== expected[index].required
      || check.timeoutMs !== expected[index].timeoutMs || JSON.stringify(check.command) !== JSON.stringify(expected[index].command)
      || !Number.isInteger(check.durationMs) || check.durationMs < 0 || typeof check.output !== "string"
      || (check.status === "timeout" && check.durationMs < check.timeoutMs)
      || (check.command === null ? check.status !== "not_run" || check.exitCode !== null || check.output !== "No executable check is configured."
        : !["passed", "failed", "missing", "timeout"].includes(check.status)
          || (check.status === "passed" ? check.exitCode !== 0
            : check.status === "missing" ? check.exitCode !== null
              : check.exitCode !== null && (!Number.isInteger(check.exitCode) || check.exitCode === 0))))) return invalid;
  const summary = aggregateChecks(receipt.checks);
  if (receipt.sourceBefore?.sourceSha256 !== receipt.sourceAfter?.sourceSha256) { summary.status = "incomplete"; summary.exitCode = 1; }
  if (receipt.status !== summary.status || receipt.exitCode !== summary.exitCode || receipt.overallProductStatus !== "INCOMPLETE" || receipt.activationStatus !== "NOT_ACTIVATED") return invalid;
  return summary;
}

function aggregateChecks(checks) {
  const incomplete = checks.some((check) => check.required && (check.status !== "passed" || check.exitCode !== 0));
  return { status: incomplete ? "incomplete" : "passed", exitCode: incomplete ? 1 : 0 };
}

/** Commands are supplied only by the local, checked-in manifest; never by CLI input. */
export async function runChecks(checks, { cwd = process.cwd(), env = process.env, onResult = () => {} } = {}) {
  const results = [];
  for (const check of checks) {
    if (!/^[a-z0-9-]+$/u.test(check.id) || typeof check.required !== "boolean"
      || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 600000
      || (check.command !== null && (!Array.isArray(check.command) || !check.command.length || check.command.some((arg) => typeof arg !== "string")))) {
      throw new Error("INVALID_CHECK_MANIFEST");
    }
    const start = Date.now();
    const result = check.command === null ? { status: "not_run", exitCode: null, output: "No executable check is configured." } : await new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const child = spawn(check.command[0], check.command.slice(1), { cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32" });
      // Bounded output; existing checks emit no credential values. Redact inherited secrets defensively.
      const secrets = Object.entries(env).filter(([name, value]) => /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL/u.test(name) && value?.length >= 8).map(([, value]) => value);
      const redact = (text) => {
        let safe = text;
        for (const secret of secrets) safe = safe.replaceAll(secret, "[REDACTED]");
        safe = safe.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gu, "$1[REDACTED]@");
        return safe;
      };
      const append = (data) => { output = (output + data.toString()).slice(-1048576); };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        timedOut = true;
        // Stop only the process tree this check created, including Vitest workers.
        if (process.platform === "win32") {
          const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          stop.on("error", () => child.kill("SIGKILL"));
        } else {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      }, check.timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); resolve({ status: error.code === "ENOENT" ? "missing" : "failed", exitCode: null, output: error.code ?? "SPAWN_FAILED" }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ status: timedOut ? "timeout" : code === 0 ? "passed" : "failed", exitCode: code, output: redact(output) }); });
    });
    const record = { id: check.id, required: check.required, command: check.command, timeoutMs: check.timeoutMs, durationMs: Date.now() - start, ...result };
    results.push(record);
    await onResult(record);
  }
  const summary = aggregateChecks(results);
  return { schemaVersion: 1, ...summary, checks: results };
}
