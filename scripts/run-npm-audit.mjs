import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const transientAuditFailure =
  /audit endpoint returned an error|network timeout|\b(?:EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b|socket hang up|\b(?:429|502|503|504)\b/iu;

export function isTransientAuditFailure(output) {
  return transientAuditFailure.test(output);
}

function runAuditCommand() {
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = windows
    ? [
        "/d",
        "/s",
        "/c",
        "npm audit --audit-level=moderate --fetch-timeout=120000",
      ]
    : ["audit", "--audit-level=moderate", "--fetch-timeout=120000"];
  const result = spawnSync(
    command,
    args,
    {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: [result.stderr, result.error?.message].filter(Boolean).join("\n"),
  };
}

function writeOutput(stream, value) {
  if (!value) {
    return;
  }
  process[stream].write(value.endsWith("\n") ? value : `${value}\n`);
}

export async function runNpmAuditWithRetry({
  maxAttempts = 3,
  runAudit = runAuditCommand,
  wait = sleep,
  write = writeOutput,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runAudit();
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    write("stdout", result.stdout ?? "");
    write("stderr", result.stderr ?? "");

    if (result.status === 0) {
      return 0;
    }

    if (!isTransientAuditFailure(output) || attempt === maxAttempts) {
      return result.status || 1;
    }

    const delayMs = attempt * 10_000;
    write(
      "stderr",
      `::warning::npm audit network failure; retrying in ${delayMs / 1000}s (${attempt}/${maxAttempts}).`,
    );
    await wait(delayMs);
  }

  return 1;
}

const isDirectInvocation =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectInvocation) {
  process.exitCode = await runNpmAuditWithRetry();
}
