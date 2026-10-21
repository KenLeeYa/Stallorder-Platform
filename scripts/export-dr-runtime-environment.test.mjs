import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];
const managedEnvironmentNames = [
  "GITHUB_ENV",
  "GITHUB_ACTIONS",
  "SUPABASE_ACCESS_TOKEN",
  "PRIMARY_SUPABASE_PROJECT_REF",
  "DR_SUPABASE_PROJECT_REF",
];
const originalEnvironment = Object.fromEntries(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Supabase DR runtime environment export", () => {
  it.each([undefined, "false"])("rejects non-Actions execution (%s) before reading secrets or calling the API", async runner => {
    vi.resetModules();
    if (runner === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = runner;
    delete process.env.SUPABASE_ACCESS_TOKEN;
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(import("./export-dr-runtime-environment.mjs")).rejects.toThrow("DR_RUNTIME_ACTIONS_REQUIRED");
    expect(request).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects a fully configured bare CLI before fetching or exposing a secret", async () => {
    vi.resetModules();
    process.env.GITHUB_ACTIONS = "false";
    process.env.SUPABASE_ACCESS_TOKEN = "synthetic-management-secret";
    process.env.PRIMARY_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
    process.env.DR_SUPABASE_PROJECT_REF = "zyxwvutsrqponmlkjihg";
    process.env.GITHUB_ENV = "must-not-write";
    process.argv.splice(2, process.argv.length);
    const request = vi.fn().mockResolvedValue(Response.json([
      { type: "secret", name: "default", api_key: "must-not-log-secret" },
      { type: "publishable", name: "default", api_key: "synthetic-public-key" },
    ]));
    vi.stubGlobal("fetch", request);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(import("./export-dr-runtime-environment.mjs")).rejects.toThrow("DR_RUNTIME_ACTIONS_REQUIRED");
    expect(request).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("exports only DR bindings in DR-only mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stallorder-dr-runtime-"));
    const githubEnvironment = join(directory, "github-env");
    const projectRef = "zyxwvutsrqponmlkjihg";
    const requestedProjects = [];

    process.argv.splice(
      0,
      process.argv.length,
      process.execPath,
      "scripts/export-dr-runtime-environment.mjs",
      "--dr-only",
    );
    process.env.GITHUB_ENV = githubEnvironment;
    process.env.GITHUB_ACTIONS = "true";
    process.env.SUPABASE_ACCESS_TOKEN = "test-access-token";
    process.env.DR_SUPABASE_PROJECT_REF = projectRef;
    delete process.env.PRIMARY_SUPABASE_PROJECT_REF;

    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(input);
      requestedProjects.push(url.pathname);
      return new Response(JSON.stringify([
        { type: "secret", name: "default", api_key: "dr-secret" },
        { type: "publishable", name: "default", api_key: "dr-publishable" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await import("./export-dr-runtime-environment.mjs?dr-only-test");
      const lines = (await readFile(githubEnvironment, "utf8"))
        .trim()
        .split(/\r?\n/u);

      expect(requestedProjects).toEqual([`/v1/projects/${projectRef}/api-keys`]);
      expect(lines).toEqual([
        `DR_SUPABASE_URL=https://${projectRef}.supabase.co`,
        "DR_SUPABASE_SECRET_KEY=dr-secret",
        "DR_SUPABASE_PUBLISHABLE_KEY=dr-publishable",
        `DR_SUPABASE_FUNCTIONS_URL=https://${projectRef}.supabase.co/functions/v1`,
      ]);
      expect(lines.some((line) => line.startsWith("PRIMARY_"))).toBe(false);
      expect(console.log).toHaveBeenCalledWith("::add-mask::dr-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
