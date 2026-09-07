import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const actionCore = vi.hoisted(() => ({ setSecret: vi.fn() }));
vi.mock("@actions/core", () => actionCore);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const values = {
  ABUSE_HASH_SECRET: "original-abuse-secret",
  TOKEN_DERIVATION_SECRET: "original-derivation-secret",
  TURNSTILE_SECRET_KEY: "original-turnstile-secret",
};
let requests;
let readbackMismatch;
const originalArgv = [...process.argv];

beforeEach(() => {
  vi.resetModules();
  requests = [];
  readbackMismatch = false;
  process.argv.splice(2);
  for (const [name, value] of Object.entries({
    SUPABASE_ACCESS_TOKEN: "test-access-token",
    PRIMARY_SUPABASE_PROJECT_REF: "primary-project",
    DR_SUPABASE_PROJECT_REF: "dr-project",
    APP_BASE_URL: "https://app.example.test",
    PRODUCTION_ENVIRONMENT_APPROVED: "true",
    DR_CHANGE_CONFIRMATION: "CONFIGURE_PRODUCTION_DR_PROJECT",
    ...Object.fromEntries(Object.entries(values).map(([name, value]) => [`PRIMARY_${name}`, value])),
  })) vi.stubEnv(name, value);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
    const path = new URL(input).pathname;
    const method = init.method ?? "GET";
    requests.push({ path, method, body: init.body && JSON.parse(init.body) });
    if (method === "GET" && path === "/v1/projects/dr-project/secrets") {
      const written = requests.find(request => request.method === "POST")?.body ?? [];
      return Response.json(written.map(({ name, value }) => ({ name, value: digest(readbackMismatch ? "wrong" : value) })));
    }
    if (method === "GET" && path.endsWith("/secrets")) {
      return Response.json([
        ...Object.entries(values).map(([name, value]) => ({ name, value: digest(value) })),
        { name: "PUBLIC_APP_ORIGINS", value: digest("https://app.example.test") },
      ]);
    }
    if (method === "GET" && path.endsWith("/config/auth")) {
      return Response.json({ external_google_enabled: true, external_google_client_id: "client", external_google_secret: "secret" });
    }
    return Response.json({});
  }));
});

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...originalArgv);
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  actionCore.setSecret.mockReset();
});

describe("DR public-order secret synchronization", () => {
  it("writes verified originals and URL origins instead of Management API digests", async () => {
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).not.toBe(1);
    const write = requests.find((request) => request.method === "POST");
    expect(write.path).toBe("/v1/projects/dr-project/secrets");
    expect(write.body).toEqual(expect.arrayContaining([
      ...Object.entries(values).map(([name, value]) => ({ name, value })),
      { name: "PUBLIC_APP_ORIGINS", value: "https://app.example.test,https://stallorder-platform.vercel.app" },
    ]));
    expect(JSON.stringify(console.log.mock.calls)).not.toContain(values.ABUSE_HASH_SECRET);
  });

  it.each([false, true].flatMap(runtimeOnly => ["missing", "digest", "mismatch"].map(mode => ({ runtimeOnly, mode }))))("does not mutate DR for $mode originals with runtimeOnly=$runtimeOnly", async ({ runtimeOnly, mode }) => {
    if (runtimeOnly) {
      process.argv.push("--runtime-only");
      vi.stubEnv("DR_CHANGE_CONFIRMATION", "SYNC_PRODUCTION_DR_RUNTIME");
    }
    vi.stubEnv("PRIMARY_TOKEN_DERIVATION_SECRET", mode === "missing" ? "" : mode === "digest" ? digest(values.TOKEN_DERIVATION_SECRET) : "wrong");
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).toBe(1);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(JSON.stringify(console.error.mock.calls)).not.toContain(values.TOKEN_DERIVATION_SECRET);
  });

  it("requires the protected operation confirmation before reading or writing", async () => {
    vi.stubEnv("DR_CHANGE_CONFIRMATION", "");
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).toBe(1);
    expect(requests).toEqual([]);
  });

  it("supports runtime-only synchronization with digest readback and no Auth or project changes", async () => {
    process.argv.push("--runtime-only");
    vi.stubEnv("DR_CHANGE_CONFIRMATION", "SYNC_PRODUCTION_DR_RUNTIME");
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).not.toBe(1);
    expect(requests.filter(request => request.method !== "GET")).toHaveLength(1);
    expect(requests.some(request => request.path.endsWith("/config/auth"))).toBe(false);
    expect(requests.at(-1)).toMatchObject({ path: "/v1/projects/dr-project/secrets", method: "GET" });
    expect(JSON.parse(console.log.mock.calls[0][0]).digestsMatched).toBe(true);
  });

  it("rejects a readback mismatch rather than reporting runtime readiness", async () => {
    process.argv.push("--runtime-only");
    vi.stubEnv("DR_CHANGE_CONFIRMATION", "SYNC_PRODUCTION_DR_RUNTIME");
    readbackMismatch = true;
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(console.error.mock.calls)).toContain("DR_RUNTIME_READBACK_MISMATCH");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("cannot use the Primary project as the runtime synchronization target", async () => {
    process.argv.push("--runtime-only");
    vi.stubEnv("DR_CHANGE_CONFIRMATION", "SYNC_PRODUCTION_DR_RUNTIME");
    vi.stubEnv("DR_SUPABASE_PROJECT_REF", "primary-project");
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).toBe(1);
    expect(requests).toEqual([]);
    expect(JSON.stringify(console.error.mock.calls)).toContain("DR_TARGET_MUST_DIFFER_FROM_PRIMARY");
  });

  it("requires the specific runtime confirmation and rejects unknown arguments without provider calls", async () => {
    process.argv.push("--runtime-only");
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).toBe(1);
    expect(requests).toEqual([]);
    vi.resetModules();
    process.argv[2] = "--unknown";
    await import("./configure-production-dr-project.mjs");
    expect(process.exitCode).toBe(1);
    expect(requests).toEqual([]);
  });
});
