import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), remove: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("node:fs", async importOriginal => ({ ...await importOriginal(), rmSync: mocks.remove }));
let originalExitCode;

beforeEach(() => {
  vi.resetModules();
  mocks.spawn.mockReset().mockReturnValue({ status: 0 });
  mocks.remove.mockReset();
  originalExitCode = process.exitCode;
  vi.stubEnv("PLAYWRIGHT_SHARD_COUNT", "3");
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("EARLY_PROCESS_EXIT"); });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("a failed shard still runs later shards and keeps the gate failed", async () => {
  mocks.spawn.mockReturnValueOnce({ status: 1 });
  await import("./run-playwright-shards.mjs");
  expect(mocks.spawn).toHaveBeenCalledTimes(3);
  expect(process.exitCode).toBe(1);
  expect(mocks.spawn.mock.calls.map(([, args]) => args.at(-1))).toEqual([
    "--output=test-results/shard-1", "--output=test-results/shard-2", "--output=test-results/shard-3",
  ]);
  expect(mocks.spawn.mock.calls[2][2].env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe(resolve("playwright-report", "shard-3"));
});

test("a terminated shard fails the gate without hiding subsequent results", async () => {
  mocks.spawn.mockReturnValueOnce({ status: null });
  await import("./run-playwright-shards.mjs");
  expect(mocks.spawn).toHaveBeenCalledTimes(3);
  expect(process.exitCode).toBe(1);
});

test("all shards passing produces a successful gate", async () => {
  await import("./run-playwright-shards.mjs");
  expect(mocks.spawn).toHaveBeenCalledTimes(3);
  expect(process.exitCode ?? 0).toBe(0);
});
test("sequential eight-shard CI budget preserves test deadlines and flaky-failure policy", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
  expect(workflow).toContain("timeout-minutes: 120");
  expect(config).toContain("workers: 1");
  expect(config).toContain("timeout: 60_000");
  expect(config).toContain("expect: { timeout: 10_000 }");
  expect(config).toContain("failOnFlakyTests: Boolean(process.env.CI)");
});

test("invalid shard count never starts a test process or removes build files", async () => {
  vi.stubEnv("PLAYWRIGHT_SHARD_COUNT", "0");
  await expect(import("./run-playwright-shards.mjs")).rejects.toThrow("PLAYWRIGHT_SHARD_COUNT_INVALID");
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
