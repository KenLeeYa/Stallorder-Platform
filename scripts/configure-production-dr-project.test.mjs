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

beforeEach(() => {
  vi.resetModules();
  requests = [];
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

  it.each(["missing", "digest", "mismatch"])("does not mutate DR when an original is %s", async (mode) => {
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
});
