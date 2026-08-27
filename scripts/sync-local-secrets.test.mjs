import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runSecretSync(value) {
  const directory = mkdtempSync(join(tmpdir(), "stallorder-secret-sync-"));
  temporaryDirectories.push(directory);
  const configPath = join(directory, "secrets.json");
  writeFileSync(configPath, JSON.stringify({
    secrets: [{ name: "NEXT_PUBLIC_APP_URL", value }],
  }));
  return spawnSync(process.execPath, [resolve("scripts/sync-local-secrets.mjs")], {
    env: { ...process.env, SECRET_SYNC_FILE: configPath },
    encoding: "utf8",
  });
}

describe("local secret URL validation", () => {
  it.each([
    "https://preview.example.com",
    "https://PREVIEW.EXAMPLE.COM./q/test",
    "https://safe.example, https://preview.example.com/q/test",
  ])("rejects the exact example Preview host: %s", (value) => {
    const result = runSecretSync(value);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("still uses the example Preview URL");
  });

  it.each([
    "https://preview.example.com.evil.test/q/test",
    "https://preview.example.com@safe.example/q/test",
    "https://safe.example/q/preview.example.com",
  ])("accepts values whose parsed host is not the example host: %s", (value) => {
    const result = runSecretSync(value);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Done: dry-run only.");
  });
});
