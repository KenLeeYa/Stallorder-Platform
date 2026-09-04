import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];
const managedEnvironmentNames = [
  "GITHUB_ENV",
  "PUBLIC_ORDER_SECRET_PREFIX",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
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

describe("public-order runtime secret export", () => {
  it("exports and masks the required project secrets without logging their values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stallorder-public-order-secrets-"));
    const githubEnvironment = join(directory, "github-env");
    const projectRef = "abcdefghijklmnopqrst";
    const logged = [];

    process.env.GITHUB_ENV = githubEnvironment;
    process.env.PUBLIC_ORDER_SECRET_PREFIX = "PRIMARY_";
    process.env.SUPABASE_ACCESS_TOKEN = "test-access-token";
    process.env.SUPABASE_PROJECT_REF = projectRef;
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      expect(String(input)).toBe(`https://api.supabase.com/v1/projects/${projectRef}/secrets`);
      return new Response(JSON.stringify([
        { name: "ABUSE_HASH_SECRET", value: "abuse-value" },
        { name: "TOKEN_DERIVATION_SECRET", value: "token-value" },
        { name: "TURNSTILE_SECRET_KEY", value: "turnstile-value" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    vi.spyOn(console, "log").mockImplementation((value) => logged.push(String(value)));

    try {
      await import("./export-public-order-runtime-secrets.mjs?success-test");
      const lines = (await readFile(githubEnvironment, "utf8")).trim().split(/\r?\n/u);

      expect(lines).toEqual([
        "PRIMARY_ABUSE_HASH_SECRET=abuse-value",
        "PRIMARY_TOKEN_DERIVATION_SECRET=token-value",
        "PRIMARY_TURNSTILE_SECRET_KEY=turnstile-value",
      ]);
      expect(logged).toEqual(expect.arrayContaining([
        "::add-mask::abuse-value",
        "::add-mask::token-value",
        "::add-mask::turnstile-value",
      ]));
      expect(logged.join("\n")).toContain("public_order_runtime_secrets_exported");
      expect(logged.join("\n")).not.toContain('"abuse-value"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when a required project secret is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stallorder-public-order-secrets-"));
    process.env.GITHUB_ENV = join(directory, "github-env");
    process.env.PUBLIC_ORDER_SECRET_PREFIX = "";
    process.env.SUPABASE_ACCESS_TOKEN = "test-access-token";
    process.env.SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { name: "ABUSE_HASH_SECRET", value: "abuse-value" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await import("./export-public-order-runtime-secrets.mjs?missing-test");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
