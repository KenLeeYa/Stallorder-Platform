import { afterEach, describe, expect, it, vi } from "vitest";

const actionCore = vi.hoisted(() => ({
  exportVariable: vi.fn(),
  setSecret: vi.fn(),
}));

vi.mock("@actions/core", () => actionCore);

const originalArgv = [...process.argv];
const managedEnvironmentNames = [
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
  actionCore.exportVariable.mockReset();
  actionCore.setSecret.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public-order runtime secret export", () => {
  it("exports and masks the required project secrets without logging their values", async () => {
    const projectRef = "abcdefghijklmnopqrst";
    const logged = [];

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

    await import("./export-public-order-runtime-secrets.mjs?success-test");

    expect(actionCore.setSecret.mock.calls).toEqual([
      ["abuse-value"],
      ["token-value"],
      ["turnstile-value"],
    ]);
    expect(actionCore.exportVariable.mock.calls).toEqual([
      ["PRIMARY_ABUSE_HASH_SECRET", "abuse-value"],
      ["PRIMARY_TOKEN_DERIVATION_SECRET", "token-value"],
      ["PRIMARY_TURNSTILE_SECRET_KEY", "turnstile-value"],
    ]);
    expect(logged).toEqual(['{"event":"public_order_runtime_secrets_exported"}']);
    expect(logged.join("\n")).not.toContain(projectRef);
    expect(logged.join("\n")).not.toContain("abuse-value");
  });

  it("fails closed when a required project secret is missing", async () => {
    process.env.PUBLIC_ORDER_SECRET_PREFIX = "";
    process.env.SUPABASE_ACCESS_TOKEN = "test-access-token";
    process.env.SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { name: "ABUSE_HASH_SECRET", value: "abuse-value" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./export-public-order-runtime-secrets.mjs?missing-test");
    expect(process.exitCode).toBe(1);
    expect(actionCore.exportVariable).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });
});
