import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { externalStatus } from "./cli.mjs";

test("absent optional settings stay disabled and never require unselected accounts", () => {
  const result = externalStatus({});
  expect(result.mode).toBe("local-mock");
  expect(result.networkCalls).toBe(0);
  expect(result.activationStatus).toBe("DISABLED_PENDING_APPROVAL");
  expect(new Set(Object.values(result.settings))).toEqual(new Set(["MISSING"]));
});

test("credentials cannot activate providers; values never enter output", () => {
  const secret = "synthetic-secret-never-print";
  const result = externalStatus({ AWESOME_EXTERNAL_MODE: "live", NOVU_API_KEY: secret });
  expect(result.exitCode).toBe(1);
  expect(result.settings.NOVU_API_KEY).toBe("PRESENT");
  expect(JSON.stringify(result)).not.toContain(secret);
  const cli = spawnSync(process.execPath, ["scripts/awesome-optimization/cli.mjs", "external-check"], {
    cwd: process.cwd(), env: { ...process.env, AWESOME_EXTERNAL_MODE: "live", NOVU_API_KEY: secret }, encoding: "utf8",
  });
  expect(cli.status).toBe(1);
  expect(cli.stdout).not.toContain(secret);
  expect(JSON.parse(cli.stdout).networkCalls).toBe(0);
});

test("report refuses missing evidence and path traversal", () => {
  for (const path of [".superpowers/sdd/2026-10-01-awesome-optimization/batch-1/runs/missing/receipt.json", "../outside.json"]) {
    const cli = spawnSync(process.execPath, ["scripts/awesome-optimization/cli.mjs", "report", `--receipt=${path}`], { cwd: process.cwd(), encoding: "utf8" });
    expect(cli.status).toBe(1);
  }
});
